// =====================================================================
// workouts.js — Modelo de entrenamientos por bloques, biblioteca
// precargada, test de FTP y utilidades (expandir, objetivo en el tiempo).
//
// Tipos de bloque (duraciones en segundos, objetivos en % de FTP):
//   warmup    { dur, from, to }          rampa ascendente
//   cooldown  { dur, from, to }          rampa descendente
//   steady    { dur, pct }               estable
//   intervals { reps, on, onPct, off, offPct }
//   free      { dur }                    libre (sin objetivo)
// Campos opcionales en cualquier bloque: label, text (instrucción),
// test: true (marca el esfuerzo de 20 min del test de FTP).
// =====================================================================

export const BLOCK_TYPES = {
  warmup:    'Calentamiento (rampa)',
  steady:    'Estable',
  intervals: 'Intervalos',
  cooldown:  'Enfriamiento (rampa)',
  free:      'Libre',
};

const m = (min) => Math.round(min * 60);

export const BUILTIN_WORKOUTS = [
  {
    id: 'builtin-recuperacion', builtin: true,
    name: 'Recuperación 30 min',
    description: 'Pedaleo suave en Z1–Z2 para recuperar.',
    blocks: [
      { type: 'warmup', dur: m(5), from: 40, to: 55 },
      { type: 'steady', dur: m(20), pct: 55 },
      { type: 'cooldown', dur: m(5), from: 55, to: 40 },
    ],
  },
  {
    id: 'builtin-sweetspot', builtin: true,
    name: 'Sweet Spot 3×10 min',
    description: '3 bloques de 10 min al 90 % con 5 min de recuperación.',
    blocks: [
      { type: 'warmup', dur: m(10), from: 50, to: 75 },
      { type: 'intervals', reps: 3, on: m(10), onPct: 90, off: m(5), offPct: 55 },
      { type: 'cooldown', dur: m(10), from: 65, to: 45 },
    ],
  },
  {
    id: 'builtin-umbral', builtin: true,
    name: 'Umbral 2×20 min',
    description: '2 bloques de 20 min al 97 % del FTP.',
    blocks: [
      { type: 'warmup', dur: m(12), from: 50, to: 80 },
      { type: 'steady', dur: m(3), pct: 55 },
      { type: 'intervals', reps: 2, on: m(20), onPct: 97, off: m(5), offPct: 55 },
      { type: 'cooldown', dur: m(10), from: 65, to: 45 },
    ],
  },
  {
    id: 'builtin-vo2', builtin: true,
    name: 'VO2máx 5×3 min',
    description: '5 repeticiones de 3 min al 115 % con 3 min suaves.',
    blocks: [
      { type: 'warmup', dur: m(12), from: 50, to: 80 },
      { type: 'steady', dur: m(3), pct: 60 },
      { type: 'intervals', reps: 5, on: m(3), onPct: 115, off: m(3), offPct: 50 },
      { type: 'cooldown', dur: m(10), from: 65, to: 45 },
    ],
  },
  {
    id: 'builtin-piramide', builtin: true,
    name: 'Pirámide',
    description: 'Escalones de 80 → 100 % y regreso, con recuperaciones.',
    blocks: [
      { type: 'warmup', dur: m(10), from: 50, to: 75 },
      { type: 'steady', dur: m(2), pct: 80 },
      { type: 'steady', dur: m(2), pct: 55 },
      { type: 'steady', dur: m(3), pct: 90 },
      { type: 'steady', dur: m(2), pct: 55 },
      { type: 'steady', dur: m(4), pct: 100 },
      { type: 'steady', dur: m(2), pct: 55 },
      { type: 'steady', dur: m(3), pct: 90 },
      { type: 'steady', dur: m(2), pct: 55 },
      { type: 'steady', dur: m(2), pct: 80 },
      { type: 'cooldown', dur: m(8), from: 65, to: 45 },
    ],
  },
];

/** Protocolo guiado del test de FTP de 20 minutos. */
export const FTP_TEST = {
  id: 'builtin-ftp-test', builtin: true, ftpTest: true,
  name: 'Test de FTP (20 min)',
  description: 'Protocolo guiado. FTP = 95 % de la potencia media de los 20 min.',
  blocks: [
    { type: 'warmup', dur: m(10), from: 45, to: 75, label: 'Calentamiento',
      text: 'Sube la intensidad poco a poco. Cadencia cómoda, 85–95 rpm.' },
    { type: 'intervals', reps: 3, on: m(1), onPct: 110, off: m(1), offPct: 50,
      label: 'Activación', text: '1 min a ritmo alto (cadencia > 100 rpm) y 1 min muy suave.' },
    { type: 'steady', dur: m(5), pct: 55, label: 'Suave',
      text: 'Recupera. Respira y relaja los hombros.' },
    { type: 'steady', dur: m(5), pct: 105, label: 'Esfuerzo 5 min',
      text: '5 min fuertes: duro pero controlado. Sirve para "abrir" las piernas.' },
    { type: 'steady', dur: m(10), pct: 50, label: 'Recuperación',
      text: 'Muy suave. Hidrátate y prepárate para los 20 minutos.' },
    { type: 'free', dur: m(20), test: true, label: 'TEST 20 MIN',
      text: 'Máximo esfuerzo SOSTENIBLE durante 20 min. Empieza contenido, mantén un ritmo parejo y vacíate en los últimos 3 min.' },
    { type: 'cooldown', dur: m(10), from: 55, to: 40, label: 'Enfriamiento',
      text: '¡Terminaste el test! Pedalea muy suave para enfriar.' },
  ],
};

/** Convierte bloques en segmentos lineales con tiempo de inicio. */
export function expandWorkout(w) {
  const segs = [];
  let t = 0;
  const push = (s) => { segs.push({ ...s, start: t }); t += s.dur; };
  w.blocks.forEach((b, bi) => {
    const base = { block: bi, label: b.label, text: b.text, test: !!b.test };
    switch (b.type) {
      case 'warmup':
      case 'cooldown':
        push({ ...base, type: b.type, dur: b.dur, from: b.from, to: b.to });
        break;
      case 'steady':
        push({ ...base, type: 'steady', dur: b.dur, from: b.pct, to: b.pct });
        break;
      case 'intervals':
        for (let r = 0; r < b.reps; r++) {
          push({ ...base, type: 'on', dur: b.on, from: b.onPct, to: b.onPct, rep: r + 1, reps: b.reps });
          // El último descanso también se hace (recuperación tras la serie).
          if (b.off > 0) push({ ...base, type: 'off', dur: b.off, from: b.offPct, to: b.offPct, rep: r + 1, reps: b.reps });
        }
        break;
      case 'free':
        push({ ...base, type: 'free', dur: b.dur, from: null, to: null });
        break;
    }
  });
  return { segments: segs, total: t };
}

/** Segmento activo y % de objetivo en el segundo t. */
export function targetAt(expanded, t) {
  const segs = expanded.segments;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (t >= s.start && t < s.start + s.dur) {
      let pct = null;
      if (s.from != null) pct = s.from + (s.to - s.from) * ((t - s.start) / s.dur);
      return { index: i, seg: s, pct, remaining: s.start + s.dur - t, next: segs[i + 1] || null };
    }
  }
  return null; // terminado
}

/** Nombre legible de un segmento. */
export function segmentName(s) {
  if (!s) return 'Fin';
  if (s.label && s.type !== 'on' && s.type !== 'off') return s.label;
  switch (s.type) {
    case 'warmup': return 'Calentamiento';
    case 'cooldown': return 'Enfriamiento';
    case 'steady': return 'Estable';
    case 'on': return `Intervalo ${s.rep}/${s.reps}`;
    case 'off': return `Descanso ${s.rep}/${s.reps}`;
    case 'free': return 'Libre';
  }
  return '';
}

/** Duración total de un entrenamiento (s). */
export function workoutDuration(w) { return expandWorkout(w).total; }

/** Formato m:ss o h:mm:ss. */
export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), mi = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${mi}:${String(s).padStart(2, '0')}`;
}

/** Interpreta "10", "10:30", "1:00:00" o "0.5" (min) → segundos. */
export function parseDuration(str) {
  str = String(str).trim().replace(',', '.');
  if (!str) return 0;
  if (str.includes(':')) {
    const parts = str.split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    return parts.reduce((acc, v) => acc * 60 + v, 0);
  }
  const n = Number(str);
  return isNaN(n) ? 0 : Math.round(n * 60);
}

/** Valida y normaliza un entrenamiento importado desde JSON. */
export function sanitizeWorkout(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.blocks)) throw new Error('JSON sin "blocks"');
  const num = (v, d = 0) => (isFinite(+v) ? +v : d);
  const blocks = o.blocks.map((b) => {
    if (!BLOCK_TYPES[b.type]) throw new Error(`Tipo de bloque desconocido: ${b.type}`);
    const out = { type: b.type };
    if (b.label) out.label = String(b.label);
    if (b.text) out.text = String(b.text);
    if (b.test) out.test = true;
    if (b.type === 'intervals') {
      out.reps = Math.max(1, Math.round(num(b.reps, 1)));
      out.on = num(b.on); out.onPct = num(b.onPct);
      out.off = num(b.off); out.offPct = num(b.offPct);
    } else {
      out.dur = num(b.dur);
      if (b.type === 'steady') out.pct = num(b.pct);
      if (b.type === 'warmup' || b.type === 'cooldown') { out.from = num(b.from); out.to = num(b.to); }
    }
    return out;
  });
  return {
    id: 'w-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: String(o.name || 'Entrenamiento importado'),
    description: String(o.description || ''),
    ftpTest: !!o.ftpTest,
    blocks,
  };
}
