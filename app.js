// =====================================================================
// app.js — Lógica principal de la interfaz: une sensor, cálculo de
// potencia, grabación, entrenamientos, historial, exportación y ajustes.
// =====================================================================
import { CSCSensor } from './ble.js';
import { CSCCalculator, parseCSCMeasurement } from './csc.js';
import { powerFromSpeed, rollingAvg, DEFAULT_CURVE } from './power.js';
import { presetZones, zoneInfo, zoneRangeText, validZones } from './zones.js';
import { Recorder } from './session.js';
import {
  BUILTIN_WORKOUTS, FTP_TEST, BLOCK_TYPES, expandWorkout, segmentName,
  workoutDuration, fmtTime, parseDuration, sanitizeWorkout,
} from './workouts.js';
import { drawPowerBars, drawWorkoutProfile } from './chart.js';
import { db, requestPersistence } from './db.js';
import { encodeFit } from './fit.js';
import { encodeTcx } from './tcx.js';
import { Simulator } from './simulator.js';
import { prefs, unlockAudio, beep, countdownTick, keepScreenOn } from './feedback.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MPH = 0.621371192;

// ---------------------------------------------------------------------
// Ajustes por defecto
// ---------------------------------------------------------------------
const DEFAULTS = {
  ftp: 200, weight: 70, circ: 2096,
  a: DEFAULT_CURVE.a, b: DEFAULT_CURVE.b, calPct: 0,
  avgWindow: 3, chartMin: 10, units: 'kmh',
  autopause: true, sound: true, vibration: true, warmupNotice: true,
  zoneType: 'zwift',
  zones: { zwift: presetZones('zwift'), coggan: presetZones('coggan') },
  sensorId: null, sensorName: null,
};

let S = structuredClone(DEFAULTS);   // ajustes activos
let userWorkouts = [];
let selectedWorkout = null;
let source = 'none';                  // 'ble' | 'demo' | 'none'
let sim = null;
let currentSession = null;            // sesión abierta en el detalle
let editing = null;                   // entrenamiento en el editor
let lastSegIndex = -1;

const sensor = new CSCSensor();
const calc = new CSCCalculator({ getCircumferenceMm: () => S.circ });
const rec = new Recorder();
const recentP = [];                   // potencia por segundo (buffer del gráfico)
const recentT = [];                   // objetivo por segundo (o null)

const curve = () => ({ a: S.a, b: S.b, calPct: S.calPct });
const zones = () => S.zones[S.zoneType];

// =====================================================================
// Inicio
// =====================================================================
async function init() {
  try {
    const saved = await db.getSetting('settings', {});
    S = { ...structuredClone(DEFAULTS), ...saved };
    S.zones = { ...structuredClone(DEFAULTS.zones), ...(saved.zones || {}) };
    userWorkouts = await db.getAll('workouts');
  } catch (e) {
    console.error(e);
    toast('No se pudo abrir el almacenamiento local');
  }
  applyPrefs();
  buildZoneBar();
  bindUI();
  renderSettings();
  updateControls();
  startLoop();
  registerSW();
  await checkDraft();

  if (!CSCSensor.supported) {
    $('sensorText').textContent = 'Sin Web Bluetooth';
    toast('Este navegador no soporta Web Bluetooth. Usa Chrome en Android (o prueba el modo Demo).', 5000);
  } else if (S.sensorId) {
    sensor.tryRestore(S.sensorId); // reconexión silenciosa (si Chrome lo permite)
  }
}

function applyPrefs() {
  prefs.sound = S.sound;
  prefs.vibration = S.vibration;
  $('powerWindowLabel').textContent = `prom. ${S.avgWindow} s`;
  $('chartCaption').textContent = `Últimos ${S.chartMin} min`;
  $('uSpeed').textContent = S.units === 'mph' ? 'mph' : 'km/h';
  $('uDist').textContent = S.units === 'mph' ? 'mi' : 'km';
}

async function saveSettings() {
  try { await db.setSetting('settings', S); } catch (e) { console.error(e); }
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
}

// =====================================================================
// Bucle principal: 4 veces por segundo revisa timeouts y, cada segundo
// exacto, calcula potencia, graba la muestra y refresca la pantalla.
// =====================================================================
let nextSec = 0;
function startLoop() {
  nextSec = Date.now() + 1000;
  setInterval(() => {
    calc.tick(performance.now());
    const now = Date.now();
    let n = 0;
    // Si Chrome retrasó los temporizadores, se recuperan hasta 10 s.
    while (now >= nextSec && n < 10) { perSecond(nextSec); nextSec += 1000; n++; }
    if (now >= nextSec) nextSec = now + 1000;
  }, 250);
}

function perSecond(tsMs) {
  const kmh = calc.speedKmh;
  const cad = calc.hasCrank ? calc.cadence : null;
  const p = powerFromSpeed(kmh, curve());

  const tgt = rec.active ? rec.targetWatts() : null;
  recentP.push(p); recentT.push(tgt);
  const maxLen = 10 * 60;
  while (recentP.length > maxLen) { recentP.shift(); recentT.shift(); }

  const recorded = rec.tick(p, kmh, cad, tsMs);
  if (recorded) {
    workoutAlerts();
    if (rec.elapsed % 30 === 0) saveDraft();
  }
  render(kmh, cad);
}

/** Cuenta regresiva 3-2-1 antes de cada cambio de bloque. */
function workoutAlerts() {
  if (!rec.workout) return;
  const info = rec.workoutInfo();
  if (!info) {
    if (lastSegIndex !== -2) {
      lastSegIndex = -2;
      countdownTick(0);
      toast(rec.workout.ftpTest ? '¡Test completado! Pulsa Terminar para ver tu FTP.' : '¡Entrenamiento completado! Sigue libre o pulsa Terminar.', 5000);
    }
    return;
  }
  if (lastSegIndex >= 0 && info.index !== lastSegIndex) {
    countdownTick(0);
    toast(segmentName(info.seg));
  }
  lastSegIndex = info.index;
  if (info.remaining >= 1 && info.remaining <= 3) countdownTick(info.remaining);
}

// =====================================================================
// Pantalla en vivo
// =====================================================================
function buildZoneBar() {
  const box = $('zoneBarSegs');
  box.innerHTML = '';
  zones().forEach((z) => {
    const d = document.createElement('div');
    d.style.background = z.color;
    box.appendChild(d);
  });
}

function fmtSpeed(kmh) { return (S.units === 'mph' ? kmh * MPH : kmh).toFixed(1); }
function fmtDist(m) { return ((m / 1000) * (S.units === 'mph' ? MPH : 1)).toFixed(2); }

function render(kmh, cad) {
  const pw = Math.round(rollingAvg(recentP, S.avgWindow));
  $('power').textContent = pw;
  $('wkg').textContent = `${(pw / (S.weight || 70)).toFixed(1)} W/kg`;

  // Zona actual
  const zs = zones();
  const zi = zoneInfo(pw, S.ftp, zs);
  $('zoneBanner').style.background = zi.color;
  $('zoneNum').textContent = `Z${zi.number}`;
  $('zoneName').textContent = zi.name;
  $('zonePct').textContent = `${Math.round(zi.pct)} %`;
  [...$('zoneBarSegs').children].forEach((el, i) => el.classList.toggle('on', i === zi.index));
  $('zoneMarker').style.left = `${((zi.index + zi.pos) / zs.length) * 100}%`;

  // Datos secundarios
  $('mSpeed').textContent = fmtSpeed(kmh);
  $('mCad').textContent = cad == null ? '--' : Math.round(cad);
  const m = rec.metrics;
  const has = rec.state !== 'idle' && m;
  $('mTime').textContent = fmtTime(has ? rec.elapsed : 0);
  $('mDist').textContent = fmtDist(has ? rec.distance : 0);
  $('mAvg').textContent = has ? Math.round(m.avgP) : 0;
  $('mMax').textContent = has ? Math.round(m.maxP) : 0;
  $('mNP').textContent = has ? Math.round(m.np) : 0;
  $('mIF').textContent = has ? m.IF(S.ftp).toFixed(2) : '0.00';
  $('mTSS').textContent = has ? Math.round(m.TSS(S.ftp)) : 0;
  $('mKJ').textContent = has ? Math.round(m.kj) : 0;

  renderWorkoutPanel(pw);

  if ($('view-live').classList.contains('active')) {
    drawPowerBars($('liveCanvas'), recentP, { ftp: S.ftp, zones: zs, windowSec: S.chartMin * 60, targets: recentT });
  }

  // Línea de estado
  let msg = '';
  if (rec.state === 'paused') msg = '⏸ En pausa';
  else if (rec.running && rec.autopaused) msg = '⏸ Autopausa: empieza a pedalear para continuar';
  else if (source === 'none' && !rec.active) msg = 'Conecta el sensor o prueba el modo Demo';
  $('statusLine').textContent = msg;
}

function renderWorkoutPanel(pw) {
  const panel = $('workoutPanel');
  const w = rec.active ? rec.workout : selectedWorkout;
  if (!w) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  const exp = rec.active ? rec.expanded : expandWorkout(w);
  const t = rec.active ? rec.elapsed : 0;
  const info = rec.active ? rec.workoutInfo() : { index: 0, seg: exp.segments[0], pct: exp.segments[0]?.from, remaining: exp.segments[0]?.dur, next: exp.segments[1] };

  const comp = $('wpComp');
  if (info && info.seg) {
    const tgt = info.pct != null ? Math.round((info.pct / 100) * S.ftp) : null;
    $('wpTarget').textContent = tgt != null ? tgt : 'Libre';
    $('wpBlockName').textContent = segmentName(info.seg);
    $('wpRemain').textContent = fmtTime(info.remaining);
    const n = info.next;
    $('wpNext').textContent = n ? `${segmentName(n)}${n.from != null ? ` · ${Math.round((n.from / 100) * S.ftp)} W` : ''} (${fmtTime(n.dur)})` : 'Fin';

    // Cumplimiento: verde ±5 %, ámbar por debajo, rojo por encima
    if (tgt != null && rec.running) {
      const r = pw / tgt;
      if (Math.abs(r - 1) <= 0.05) { comp.dataset.c = 'ok'; $('wpCompText').textContent = '✓ En rango'; }
      else if (r < 1) { comp.dataset.c = 'low'; $('wpCompText').textContent = `▲ Sube ${tgt - pw} W`; }
      else { comp.dataset.c = 'high'; $('wpCompText').textContent = `▼ Baja ${pw - tgt} W`; }
    } else { comp.dataset.c = ''; $('wpCompText').textContent = tgt == null ? 'Libre' : '--'; }

    // Instrucciones (test de FTP) y promedio del bloque de test
    let text = info.seg.text || '';
    if (info.seg.test && rec.active && rec.testPowers.length) {
      const avg = rec.testPowers.reduce((a, b) => a + b, 0) / rec.testPowers.length;
      text += `<br><b>Promedio del test: ${Math.round(avg)} W · FTP estimado: ${Math.round(avg * 0.95)} W</b>`;
    }
    $('wpText').innerHTML = text;
    $('wpText').classList.toggle('hidden', !text);
  } else {
    $('wpTarget').textContent = '✓';
    $('wpBlockName').textContent = 'Completado';
    $('wpRemain').textContent = '0:00';
    $('wpNext').textContent = 'Fin';
    comp.dataset.c = ''; $('wpCompText').textContent = '--';
    $('wpText').classList.add('hidden');
  }
  if ($('view-live').classList.contains('active')) {
    drawWorkoutProfile($('profileCanvas'), exp, {
      ftp: S.ftp, zones: zones(), progressSec: t, actual: rec.active ? rec.samples.p : null,
    });
  }
}

function updateControls() {
  const active = rec.active;
  $('btnStart').classList.toggle('hidden', active);
  $('btnPause').classList.toggle('hidden', !active);
  $('btnStop').classList.toggle('hidden', !active);
  $('btnPause').textContent = rec.state === 'paused' ? 'Reanudar' : 'Pausar';
  $('btnWorkoutPick').disabled = active;
  $('workoutPickName').textContent = selectedWorkout ? selectedWorkout.name : 'Libre';
}

// =====================================================================
// Sesión: iniciar, pausar, terminar, guardar
// =====================================================================
async function startSession() {
  unlockAudio();
  if (source === 'none') {
    const ok = await confirmModal('Sin sensor', 'No hay ningún sensor conectado. ¿Iniciar de todos modos? La sesión quedará en autopausa hasta recibir velocidad.', 'Iniciar', 'Cancelar');
    if (!ok) return;
  }
  if (S.warmupNotice) {
    const ok = await modal(
      `<h2>Antes de empezar</h2>
       <p><b>Calienta 10 minutos:</b> el fluido del rodillo cambia la resistencia al calentarse.</p>
       <p><b>Aprieta el rodillo 2,5 vueltas</b> después de que toque la llanta y mantén siempre la misma presión de llanta.</p>`,
      [{ label: 'Cancelar', value: false, cls: 'ghost' }, { label: 'Entendido, empezar', value: true, cls: 'primary' }]);
    if (!ok) return;
  }
  rec.start({ workout: selectedWorkout, ftp: S.ftp, zones: structuredClone(zones()), zoneType: S.zoneType, autopause: S.autopause });
  lastSegIndex = -1;
  recentT.fill(null);
  keepScreenOn(true);
  requestPersistence();
  beep(990, 200);
  updateControls();
}

function togglePause() {
  if (rec.state === 'running') rec.pause(); else rec.resume();
  updateControls();
}

async function stopSession() {
  const ok = await confirmModal('Terminar sesión', '¿Quieres terminar la sesión?', 'Terminar', 'Seguir');
  if (!ok) return;
  const sess = rec.finish();
  keepScreenOn(false);
  updateControls();
  await showSummary(sess);
  rec.state = 'idle';
  updateControls();
}

function zoneTimeHTML(zoneSeconds, zs) {
  const total = zoneSeconds.reduce((a, b) => a + b, 0) || 1;
  return zs.map((z, i) => {
    const s = zoneSeconds[i] || 0;
    return `<div class="zt-row">
      <div class="zt-z" style="background:${z.color}">Z${i + 1}</div>
      <div class="zt-bar"><div style="width:${(s / total) * 100}%;background:${z.color}"></div></div>
      <div class="zt-t">${fmtTime(s)}</div></div>`;
  }).join('');
}

function summaryGridHTML(sum, ftp, endMs, startMs) {
  return `<div class="sum-grid">
    <div><span class="lbl">Tiempo</span><b>${fmtTime(sum.seconds)}</b></div>
    <div><span class="lbl">Distancia</span><b>${fmtDist(sum.distance)} ${S.units === 'mph' ? 'mi' : 'km'}</b></div>
    <div><span class="lbl">Promedio</span><b>${sum.avgPower} W</b></div>
    <div><span class="lbl">Máxima</span><b>${sum.maxPower} W</b></div>
    <div><span class="lbl">NP</span><b>${sum.np} W</b></div>
    <div><span class="lbl">IF</span><b>${(+sum.IF).toFixed(2)}</b></div>
    <div><span class="lbl">TSS</span><b>${Math.round(sum.tss)}</b></div>
    <div><span class="lbl">Trabajo</span><b>${sum.kj} kJ</b></div>
    <div><span class="lbl">Cadencia</span><b>${sum.avgCadence || '--'}</b></div>
  </div>`;
}

async function showSummary(sess) {
  const ft = sess.ftpTest;
  let ftpHtml = '';
  if (ft) {
    ftpHtml = `<div class="ftp-result">
      <div class="lbl">FTP estimado</div><div class="big">${ft.ftp} W</div>
      <div>Promedio de ${fmtTime(ft.seconds)} de test: ${ft.avg20} W</div>
      ${ft.complete ? '' : '<div class="error">El bloque de 20 min no se completó: el resultado es aproximado.</div>'}
    </div>`;
  }
  const save = await modal(
    `<h2>Resumen</h2><div class="muted">${esc(sess.name)}</div>
     ${ftpHtml}${summaryGridHTML(sess.summary, sess.ftp)}
     <h3>Tiempo en cada zona</h3>${zoneTimeHTML(sess.summary.zoneSeconds, sess.zones)}`,
    [{ label: 'Descartar', value: false, cls: 'danger' }, { label: 'Guardar', value: true, cls: 'primary' }]);

  if (!save) {
    const sure = await confirmModal('Descartar', 'La sesión se borrará y no se podrá recuperar.', 'Descartar', 'Volver');
    if (!sure) return showSummary(sess);
    await db.deleteSetting('draft');
    toast('Sesión descartada');
    return;
  }
  await saveSession(sess);
  if (ft && ft.ftp > 0) await askUpdateFtp(ft);
  await openSession(sess.id);
}

async function saveSession(sess) {
  const { samples, ...meta } = sess;
  await db.put('sessions', meta);
  await db.put('samples', { id: sess.id, ...samples });
  await db.deleteSetting('draft');
  toast('Sesión guardada');
}

async function askUpdateFtp(ft) {
  const ok = await confirmModal('Actualizar FTP',
    `Tu FTP actual es ${S.ftp} W. ¿Actualizarlo a <b>${ft.ftp} W</b> y recalcular tus zonas?`, 'Actualizar', 'No');
  if (!ok) return;
  S.ftp = ft.ftp;
  await saveSettings();
  await db.add('ftpHistory', { date: Date.now(), ftp: ft.ftp, source: 'test', avg20: ft.avg20 });
  renderSettings();
  toast(`FTP actualizado a ${ft.ftp} W`);
}

/** Guarda la sesión en curso cada 30 s por si se cierra la app. */
function saveDraft() {
  if (!rec.active || rec.elapsed < 5) return;
  db.setSetting('draft', rec.toSession()).catch(() => {});
}

async function checkDraft() {
  let d = null;
  try { d = await db.getSetting('draft', null); } catch (e) { return; }
  if (!d || !d.samples || d.samples.p.length < 10) return;
  const ok = await confirmModal('Sesión sin terminar',
    `Se encontró una sesión del ${new Date(d.startMs).toLocaleString('es')} (${fmtTime(d.samples.p.length)}). ¿Guardarla en el historial?`,
    'Guardar', 'Descartar');
  if (ok) {
    d.endMs = d.samples.ts[d.samples.ts.length - 1] + 1000;
    await saveSession(d);
  } else await db.deleteSetting('draft');
}

// =====================================================================
// Sensor y modo Demo
// =====================================================================
function setPill(state, text) {
  $('sensorPill').dataset.state = state;
  $('sensorText').textContent = text;
}

sensor.addEventListener('status', (e) => {
  const { state, name, message } = e.detail;
  if (source === 'demo') return;
  source = state === 'disconnected' ? 'none' : 'ble';
  const texts = {
    connected: name || 'Sensor conectado',
    connecting: 'Conectando…',
    reconnecting: `Reconectando… ${message || ''}`,
    disconnected: 'Sin sensor',
  };
  setPill(state, texts[state]);
  if (state === 'disconnected') $('battery').textContent = '';
  $('btnConnect').textContent = state === 'disconnected' ? 'Conectar' : 'Desconectar';
  if (state === 'connected') toast(`Conectado: ${name || 'sensor'}`);
  if (state === 'reconnecting' && sensor.retry === 1) { toast('Señal perdida. Reconectando…'); beep(440, 300); }
});
sensor.addEventListener('measurement', (e) => { if (source === 'ble') calc.update(e.detail.data, e.detail.at); });
sensor.addEventListener('battery', (e) => { $('battery').textContent = `🔋${e.detail.level}%`; });
sensor.addEventListener('feature', (e) => {
  const f = e.detail;
  if (!f.wheel) toast('El sensor está en modo CADENCIA: para calcular potencia móntalo en el buje de la rueda trasera (modo velocidad).', 7000);
});

async function onConnect() {
  unlockAudio();
  if (source === 'ble') { sensor.disconnect(); return; }
  if (sim && sim.running) stopDemo();
  try {
    calc.reset();
    await sensor.requestAndConnect();
    S.sensorId = sensor.device.id;
    S.sensorName = sensor.device.name || 'Sensor CSC';
    saveSettings(); renderSettings();
  } catch (e) {
    if (e.name === 'NotFoundError') toast('No se eligió ningún sensor');
    else if (e.name === 'SecurityError') toast('Web Bluetooth requiere HTTPS');
    else toast(`Error: ${e.message}`, 5000);
  }
}

function startDemo() {
  unlockAudio();
  if (source === 'ble') sensor.disconnect();
  calc.reset();
  if (!sim) {
    sim = new Simulator({
      getCircumferenceMm: () => S.circ,
      getCurve: curve,
      getTargetWatts: () => (rec.running ? rec.targetWatts() : null),
      getFtp: () => S.ftp,
    });
    sim.addEventListener('packet', (e) => {
      if (source === 'demo') calc.update(parseCSCMeasurement(e.detail.dv), e.detail.at);
    });
    sim.addEventListener('battery', (e) => { if (source === 'demo') $('battery').textContent = `🔋${e.detail.level}%`; });
  }
  source = 'demo';
  sim.start();
  setPill('demo', 'Simulador (Demo)');
  $('btnDemo').textContent = 'Salir demo';
  $('btnConnect').textContent = 'Conectar';
  $('btnSimStop').classList.remove('hidden');
  toast('Modo Demo: velocidad y cadencia simuladas');
}

function stopDemo() {
  if (sim) sim.stop();
  source = 'none';
  calc.reset();
  setPill('disconnected', 'Sin sensor');
  $('battery').textContent = '';
  $('btnDemo').textContent = 'Demo';
  $('btnSimStop').classList.add('hidden');
}

// =====================================================================
// Navegación, modales y avisos
// =====================================================================
const TAB_OF = { live: 'live', workouts: 'workouts', editor: 'workouts', history: 'history', session: 'history', settings: 'settings' };

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === TAB_OF[name]));
  window.scrollTo(0, 0);
  if (name === 'workouts') renderWorkouts();
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
  if (name === 'live') render(calc.speedKmh, calc.hasCrank ? calc.cadence : null);
}

function modal(html, buttons) {
  return new Promise((resolve) => {
    $('modalBody').innerHTML = html;
    const box = $('modalActions');
    box.innerHTML = '';
    buttons.forEach((b) => {
      const el = document.createElement('button');
      el.className = `btn ${b.cls || ''}`;
      el.textContent = b.label;
      el.onclick = () => { $('modal').classList.add('hidden'); resolve(b.value); };
      box.appendChild(el);
    });
    $('modal').classList.remove('hidden');
  });
}

function confirmModal(title, text, ok = 'Aceptar', cancel = 'Cancelar') {
  return modal(`<h2>${title}</h2><p>${text}</p>`,
    [{ label: cancel, value: false, cls: 'ghost' }, { label: ok, value: true, cls: 'primary' }]);
}

let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function fileStamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// =====================================================================
// Biblioteca de entrenamientos
// =====================================================================
function allWorkouts() { return [...BUILTIN_WORKOUTS, ...userWorkouts.sort((a, b) => a.name.localeCompare(b.name))]; }

async function pickWorkout() {
  const list = allWorkouts();
  const items = [`<button class="btn" data-i="-1">Libre<small>Sin objetivo, solo potencia y zonas</small></button>`,
    `<button class="btn" data-i="ftp">${esc(FTP_TEST.name)}<small>${fmtTime(workoutDuration(FTP_TEST))}</small></button>`,
    ...list.map((w, i) => `<button class="btn" data-i="${i}">${esc(w.name)}<small>${fmtTime(workoutDuration(w))} · ${esc(w.description || '')}</small></button>`)];
  const p = modal(`<h2>Elegir entrenamiento</h2><div class="pick-list">${items.join('')}</div>`,
    [{ label: 'Cerrar', value: null, cls: 'ghost' }]);
  $('modalBody').querySelectorAll('[data-i]').forEach((b) => {
    b.onclick = () => {
      const i = b.dataset.i;
      selectWorkout(i === '-1' ? null : i === 'ftp' ? FTP_TEST : list[+i]);
      $('modal').classList.add('hidden');
    };
  });
  await p;
}

function selectWorkout(w) {
  selectedWorkout = w;
  updateControls();
  render(calc.speedKmh, calc.hasCrank ? calc.cadence : null);
}

function renderWorkouts() {
  const box = $('workoutList');
  box.innerHTML = '';
  for (const w of allWorkouts()) {
    const card = document.createElement('div');
    card.className = 'wo-card';
    card.innerHTML = `
      <h3>${esc(w.name)}</h3>
      <div class="wo-meta">${fmtTime(workoutDuration(w))}${w.builtin ? ' · precargado' : ''} — ${esc(w.description || '')}</div>
      <canvas></canvas>
      <div class="wo-actions">
        <button class="btn small primary" data-act="use">Usar</button>
        <button class="btn small" data-act="dup">Duplicar</button>
        ${w.builtin ? '' : '<button class="btn small" data-act="edit">Editar</button>'}
        <button class="btn small ghost" data-act="export">Exportar</button>
        ${w.builtin ? '' : '<button class="btn small danger" data-act="del">Borrar</button>'}
      </div>`;
    card.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => workoutAction(b.dataset.act, w); });
    box.appendChild(card);
    requestAnimationFrame(() => drawWorkoutProfile(card.querySelector('canvas'), expandWorkout(w), { ftp: S.ftp, zones: zones() }));
  }
}

async function workoutAction(act, w) {
  switch (act) {
    case 'use':
      if (rec.active) { toast('Termina la sesión actual primero'); return; }
      selectWorkout(w); showView('live'); toast(`Entrenamiento: ${w.name}`);
      break;
    case 'dup': {
      const copy = { ...structuredClone(w), id: 'w-' + Date.now().toString(36), name: `${w.name} (copia)` };
      delete copy.builtin;
      await db.put('workouts', copy); userWorkouts.push(copy);
      renderWorkouts(); toast('Duplicado');
      break;
    }
    case 'edit': openEditor(w); break;
    case 'export': {
      const { id, builtin, ...data } = w;
      download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        `${w.name.replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '').trim().replace(/\s+/g, '_') || 'entreno'}.json`);
      break;
    }
    case 'del':
      if (!(await confirmModal('Borrar', `¿Borrar "${esc(w.name)}"?`, 'Borrar', 'Cancelar'))) return;
      await db.delete('workouts', w.id);
      userWorkouts = userWorkouts.filter((x) => x.id !== w.id);
      if (selectedWorkout && selectedWorkout.id === w.id) selectWorkout(null);
      renderWorkouts();
      break;
  }
}

async function importWorkouts(file) {
  try {
    const data = JSON.parse(await file.text());
    const arr = Array.isArray(data) ? data : [data];
    for (const o of arr) {
      const w = sanitizeWorkout(o);
      await db.put('workouts', w); userWorkouts.push(w);
    }
    renderWorkouts();
    toast(`${arr.length} entrenamiento(s) importado(s)`);
  } catch (e) {
    toast(`No se pudo importar: ${e.message}`, 5000);
  }
}

// =====================================================================
// Editor de entrenamientos
// =====================================================================
const NEW_BLOCK = {
  warmup: { type: 'warmup', dur: 600, from: 50, to: 75 },
  steady: { type: 'steady', dur: 600, pct: 75 },
  intervals: { type: 'intervals', reps: 4, on: 180, onPct: 110, off: 180, offPct: 55 },
  cooldown: { type: 'cooldown', dur: 600, from: 65, to: 45 },
  free: { type: 'free', dur: 600 },
};

function openEditor(w) {
  editing = w ? structuredClone(w) : { id: 'w-' + Date.now().toString(36), name: 'Nuevo entrenamiento', description: '', blocks: [structuredClone(NEW_BLOCK.warmup), structuredClone(NEW_BLOCK.steady), structuredClone(NEW_BLOCK.cooldown)] };
  $('editorTitle').textContent = w ? 'Editar entrenamiento' : 'Nuevo entrenamiento';
  $('edName').value = editing.name;
  $('edDesc').value = editing.description || '';
  showView('editor');
  renderEditorBlocks();
}

function blockFields(b) {
  const dur = (k, label) => `<label>${label}<input data-k="${k}" data-kind="dur" inputmode="decimal" value="${fmtTime(b[k])}"></label>`;
  const num = (k, label) => `<label>${label}<input data-k="${k}" data-kind="num" type="number" inputmode="numeric" value="${b[k]}"></label>`;
  let f = '';
  switch (b.type) {
    case 'warmup': case 'cooldown': f = dur('dur', 'Duración') + num('from', 'Desde % FTP') + num('to', 'Hasta % FTP'); break;
    case 'steady': f = dur('dur', 'Duración') + num('pct', '% FTP'); break;
    case 'intervals': f = num('reps', 'Repeticiones') + '<span></span>' + dur('on', 'Trabajo') + num('onPct', '% FTP trabajo') + dur('off', 'Descanso') + num('offPct', '% FTP descanso'); break;
    case 'free': f = dur('dur', 'Duración'); break;
  }
  f += `<label class="full">Etiqueta (opcional)<input data-k="label" data-kind="text" value="${esc(b.label || '')}"></label>`;
  f += `<label class="full">Instrucción en pantalla (opcional)<input data-k="text" data-kind="text" value="${esc(b.text || '')}"></label>`;
  return f;
}

function renderEditorBlocks() {
  const box = $('edBlocks');
  box.innerHTML = '';
  editing.blocks.forEach((b, i) => {
    const el = document.createElement('div');
    el.className = 'blk';
    el.innerHTML = `
      <div class="blk-head">
        <select data-type>${Object.entries(BLOCK_TYPES).map(([k, v]) => `<option value="${k}" ${k === b.type ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn small ghost" data-mv="-1" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn small ghost" data-mv="1" ${i === editing.blocks.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn small danger" data-del>✕</button>
      </div>
      <div class="blk-fields">${blockFields(b)}</div>`;
    el.querySelector('[data-type]').onchange = (e) => {
      const nb = structuredClone(NEW_BLOCK[e.target.value]);
      if (b.dur && nb.dur) nb.dur = b.dur;
      if (b.label) nb.label = b.label;
      if (b.text) nb.text = b.text;
      editing.blocks[i] = nb;
      renderEditorBlocks();
    };
    el.querySelectorAll('[data-mv]').forEach((btn) => {
      btn.onclick = () => {
        const j = i + +btn.dataset.mv;
        [editing.blocks[i], editing.blocks[j]] = [editing.blocks[j], editing.blocks[i]];
        renderEditorBlocks();
      };
    });
    el.querySelector('[data-del]').onclick = () => { editing.blocks.splice(i, 1); renderEditorBlocks(); };
    el.querySelectorAll('[data-k]').forEach((inp) => {
      inp.oninput = () => {
        const k = inp.dataset.k, kind = inp.dataset.kind;
        if (kind === 'dur') b[k] = parseDuration(inp.value);
        else if (kind === 'num') b[k] = Number(inp.value) || 0;
        else { if (inp.value.trim()) b[k] = inp.value; else delete b[k]; }
        updateEditorPreview();
      };
    });
    box.appendChild(el);
  });
  updateEditorPreview();
}

function updateEditorPreview() {
  const exp = expandWorkout(editing);
  $('edTotal').textContent = fmtTime(exp.total);
  drawWorkoutProfile($('edProfile'), exp, { ftp: S.ftp, zones: zones() });
  // Color del borde de cada bloque según su zona
  const zs = zones();
  [...$('edBlocks').children].forEach((el, i) => {
    const b = editing.blocks[i];
    const pct = b.type === 'steady' ? b.pct : b.type === 'intervals' ? b.onPct : b.type === 'free' ? null : (b.from + b.to) / 2;
    el.style.borderLeftColor = pct == null ? '#666' : zoneInfo((pct / 100) * S.ftp, S.ftp, zs).color;
  });
}

async function saveEditor() {
  editing.name = $('edName').value.trim() || 'Sin nombre';
  editing.description = $('edDesc').value.trim();
  if (!editing.blocks.length) { toast('Añade al menos un bloque'); return; }
  const bad = editing.blocks.some((b) => (b.type === 'intervals' ? !(b.on > 0) || !(b.reps > 0) : !(b.dur > 0)));
  if (bad) { toast('Revisa las duraciones: deben ser mayores que 0'); return; }
  await db.put('workouts', editing);
  userWorkouts = userWorkouts.filter((w) => w.id !== editing.id).concat(editing);
  if (selectedWorkout && selectedWorkout.id === editing.id) selectedWorkout = editing;
  toast('Guardado');
  showView('workouts');
}

// =====================================================================
// Historial y detalle de sesión
// =====================================================================
async function renderHistory() {
  const box = $('historyList');
  const list = (await db.getAll('sessions')).sort((a, b) => b.startMs - a.startMs);
  if (!list.length) { box.innerHTML = '<p class="muted">Aún no hay sesiones guardadas.</p>'; return; }
  box.innerHTML = list.map((s) => `
    <div class="hist-card" data-id="${s.id}">
      <h3>${esc(s.name)}</h3>
      <div class="wo-meta">${new Date(s.startMs).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}</div>
      <div class="hist-stats">
        <span><b>${fmtTime(s.summary.seconds)}</b></span>
        <span><b>${fmtDist(s.summary.distance)}</b> ${S.units === 'mph' ? 'mi' : 'km'}</span>
        <span><b>${s.summary.avgPower}</b> W prom.</span>
        <span>NP <b>${s.summary.np}</b></span>
        <span>TSS <b>${Math.round(s.summary.tss)}</b></span>
        ${s.ftpTest ? `<span>FTP <b>${s.ftpTest.ftp}</b></span>` : ''}
      </div>
    </div>`).join('');
  box.querySelectorAll('.hist-card').forEach((c) => { c.onclick = () => openSession(c.dataset.id); });
}

async function openSession(id) {
  const meta = await db.get('sessions', id);
  const smp = await db.get('samples', id);
  if (!meta || !smp) { toast('Sesión no encontrada'); return; }
  const { id: _, ...samples } = smp;
  currentSession = { ...meta, samples };
  $('sdTitle').textContent = meta.name;
  $('sdDate').textContent = new Date(meta.startMs).toLocaleString('es', { dateStyle: 'full', timeStyle: 'short' }) + ` · FTP ${meta.ftp} W`;
  const s = meta.summary;
  const cell = (l, v) => `<div class="metric"><div class="lbl">${l}</div><div class="val">${v}</div></div>`;
  $('sdSummary').innerHTML = [
    cell('Tiempo', fmtTime(s.seconds)), cell('Distancia', `${fmtDist(s.distance)}<small>${S.units === 'mph' ? 'mi' : 'km'}</small>`),
    cell('Promedio', `${s.avgPower}<small>W</small>`), cell('Máxima', `${s.maxPower}<small>W</small>`),
    cell('NP', `${s.np}<small>W</small>`), cell('IF', (+s.IF).toFixed(2)), cell('TSS', Math.round(s.tss)),
    cell('Trabajo', `${s.kj}<small>kJ</small>`), cell('Cadencia', s.avgCadence ? `${s.avgCadence}<small>rpm</small>` : '--'),
    ...(meta.ftpTest ? [cell('FTP test', `${meta.ftpTest.ftp}<small>W</small>`)] : []),
  ].join('');
  $('sdZones').innerHTML = zoneTimeHTML(s.zoneSeconds, meta.zones);
  const f = new File([encodeFit(currentSession)], 'x.fit', { type: 'application/octet-stream' });
  $('sdShare').classList.toggle('hidden', !(navigator.canShare && navigator.canShare({ files: [f] })));
  showView('session');
  requestAnimationFrame(() => drawPowerBars($('sdChart'), samples.p, { ftp: meta.ftp, zones: meta.zones, windowSec: Math.max(60, samples.p.length) }));
}

function exportFit() {
  const bytes = encodeFit(currentSession);
  download(new Blob([bytes], { type: 'application/octet-stream' }), `rodillo_${fileStamp(currentSession.startMs)}.fit`);
}
function exportTcx() {
  download(new Blob([encodeTcx(currentSession)], { type: 'application/vnd.garmin.tcx+xml' }), `rodillo_${fileStamp(currentSession.startMs)}.tcx`);
}
async function shareFit() {
  const file = new File([encodeFit(currentSession)], `rodillo_${fileStamp(currentSession.startMs)}.fit`, { type: 'application/octet-stream' });
  try { await navigator.share({ files: [file], title: currentSession.name }); } catch (e) { /* cancelado */ }
}
async function deleteSession() {
  if (!(await confirmModal('Borrar sesión', 'Esta acción no se puede deshacer.', 'Borrar', 'Cancelar'))) return;
  await db.delete('sessions', currentSession.id);
  await db.delete('samples', currentSession.id);
  toast('Sesión borrada');
  showView('history');
}

// =====================================================================
// Ajustes
// =====================================================================
async function renderSettings() {
  $('sFtp').value = S.ftp;
  $('sWeight').value = S.weight;
  $('sCirc').value = S.circ;
  $('sA').value = S.a;
  $('sB').value = S.b;
  $('sCal').value = S.calPct;
  $('sCalVal').textContent = `${S.calPct > 0 ? '+' : ''}${S.calPct} %`;
  $('sAvg').value = S.avgWindow;
  $('sChartMin').value = S.chartMin;
  $('sUnits').value = S.units;
  $('sAutopause').checked = S.autopause;
  $('sSound').checked = S.sound;
  $('sVibration').checked = S.vibration;
  $('sWarmup').checked = S.warmupNotice;
  $('sZoneType').value = S.zoneType;
  $('sSensorInfo').textContent = S.sensorName ? `Sensor guardado: ${S.sensorName}` : 'Ningún sensor guardado.';
  const pv = (k) => Math.round(powerFromSpeed(k, curve()));
  $('sCurvePreview').textContent = `20 km/h → ${pv(20)} W · 30 km/h → ${pv(30)} W · 40 km/h → ${pv(40)} W`;
  renderZoneRows();
  try {
    const h = (await db.getAll('ftpHistory')).sort((a, b) => b.date - a.date);
    $('ftpHistory').innerHTML = h.length
      ? h.map((x) => `<div><span>${new Date(x.date).toLocaleDateString('es')}</span><span>${x.source === 'test' ? 'Test' : 'Manual'}</span><b>${x.ftp} W</b></div>`).join('')
      : '<p class="muted">Sin registros todavía.</p>';
  } catch (e) {}
}

function renderZoneRows() {
  const zs = zones();
  $('zoneRows').innerHTML = zs.map((z, i) => `
    <tr>
      <td style="background:${z.color}">Z${i + 1}</td>
      <td><input data-zi="${i}" data-zk="name" value="${esc(z.name)}"></td>
      <td><input data-zi="${i}" data-zk="from" type="number" value="${z.from}" ${i === 0 ? 'disabled' : ''}></td>
      <td><input data-zi="${i}" data-zk="color" type="color" value="${z.color}"></td>
    </tr>`).join('') +
    `<tr><td colspan="4" class="muted" style="background:none;color:var(--muted);font-weight:400;text-align:left">
      ${zs.map((z, i) => `Z${i + 1}: ${zoneRangeText(zs, i)} = ${Math.round((z.from / 100) * S.ftp)} W`).join(' · ')}</td></tr>`;
  $('zoneRows').querySelectorAll('input').forEach((inp) => {
    inp.onchange = () => {
      const copy = structuredClone(zones());
      const z = copy[+inp.dataset.zi];
      z[inp.dataset.zk] = inp.dataset.zk === 'from' ? Number(inp.value) : inp.value;
      if (!validZones(copy)) { $('zoneError').classList.remove('hidden'); return; }
      $('zoneError').classList.add('hidden');
      S.zones[S.zoneType] = copy;
      saveSettings(); buildZoneBar(); renderZoneRows();
    };
  });
}

function bindSettings() {
  const num = (id, key, min, max, after) => {
    $(id).onchange = () => {
      let v = Number($(id).value);
      if (!isFinite(v) || v < min || v > max) { toast(`Valor fuera de rango (${min}–${max})`); $(id).value = S[key]; return; }
      S[key] = v; saveSettings(); if (after) after(v); renderSettings();
    };
  };
  num('sFtp', 'ftp', 50, 600, (v) => db.add('ftpHistory', { date: Date.now(), ftp: v, source: 'manual' }));
  num('sWeight', 'weight', 30, 200);
  num('sCirc', 'circ', 1000, 2500);
  num('sA', 'a', 0, 100);
  num('sB', 'b', 0, 1);
  $('sCal').oninput = () => { $('sCalVal').textContent = `${$('sCal').value > 0 ? '+' : ''}${$('sCal').value} %`; };
  $('sCal').onchange = () => { S.calPct = Number($('sCal').value); saveSettings(); renderSettings(); };
  $('sCurveReset').onclick = () => { S.a = DEFAULT_CURVE.a; S.b = DEFAULT_CURVE.b; S.calPct = 0; saveSettings(); renderSettings(); toast('Curva Fluid 2 restaurada'); };
  const sel = (id, key, cast) => { $(id).onchange = () => { S[key] = cast($(id).value); saveSettings(); applyPrefs(); }; };
  sel('sAvg', 'avgWindow', Number);
  sel('sChartMin', 'chartMin', Number);
  sel('sUnits', 'units', String);
  $('sZoneType').onchange = () => { S.zoneType = $('sZoneType').value; saveSettings(); buildZoneBar(); renderZoneRows(); };
  const chk = (id, key) => { $(id).onchange = () => { S[key] = $(id).checked; saveSettings(); applyPrefs(); if (key === 'autopause') rec.autopause = S[key]; }; };
  chk('sAutopause', 'autopause'); chk('sSound', 'sound'); chk('sVibration', 'vibration'); chk('sWarmup', 'warmupNotice');
  $('sZonesReset').onclick = () => { S.zones[S.zoneType] = presetZones(S.zoneType); saveSettings(); buildZoneBar(); renderZoneRows(); $('zoneError').classList.add('hidden'); };
  $('sForget').onclick = () => { S.sensorId = null; S.sensorName = null; saveSettings(); if (source === 'ble') sensor.disconnect(); renderSettings(); toast('Sensor olvidado'); };
}

// =====================================================================
// Enlaces de la interfaz
// =====================================================================
function bindUI() {
  document.querySelectorAll('#tabbar button').forEach((b) => { b.onclick = () => showView(b.dataset.view); });
  $('btnConnect').onclick = onConnect;
  $('btnDemo').onclick = () => (source === 'demo' ? stopDemo() : startDemo());
  $('btnStart').onclick = startSession;
  $('btnPause').onclick = togglePause;
  $('btnStop').onclick = stopSession;
  $('btnWorkoutPick').onclick = pickWorkout;
  $('btnSimStop').onclick = () => { if (sim) { sim.pauseFor(10); toast('Simulando 10 s sin pedalear'); } };

  $('btnFtpTest').onclick = () => {
    if (rec.active) { toast('Termina la sesión actual primero'); return; }
    selectWorkout(FTP_TEST); showView('live'); toast('Test de FTP listo: pulsa Iniciar');
  };
  $('btnNewWorkout').onclick = () => openEditor(null);
  $('btnImport').onclick = () => $('importFile').click();
  $('importFile').onchange = (e) => { const f = e.target.files[0]; if (f) importWorkouts(f); e.target.value = ''; };

  $('edSave').onclick = saveEditor;
  $('edCancel').onclick = () => showView('workouts');
  document.querySelectorAll('[data-add]').forEach((b) => {
    b.onclick = () => { editing.blocks.push(structuredClone(NEW_BLOCK[b.dataset.add])); renderEditorBlocks(); };
  });

  $('sdBack').onclick = () => showView('history');
  $('sdFit').onclick = exportFit;
  $('sdTcx').onclick = exportTcx;
  $('sdShare').onclick = shareFit;
  $('sdDelete').onclick = deleteSession;

  bindSettings();

  // Guardar borrador al ocultar la app y avisar antes de cerrarla
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveDraft(); });
  window.addEventListener('beforeunload', (e) => { if (rec.active) { saveDraft(); e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('resize', () => render(calc.speedKmh, calc.hasCrank ? calc.cadence : null));
}

init();

// Exponer para pruebas desde la consola
window.__app = { calc, rec, sensor, get S() { return S; } };
