// =====================================================================
// chart.js — Gráficos en <canvas> sin librerías:
//  - drawPowerBars: potencia como barras coloreadas por zona (vivo/historial)
//  - drawWorkoutProfile: perfil del entrenamiento con marcador de avance
// =====================================================================
import { zoneIndexForPct } from './zones.js';

/** Prepara el canvas para pantallas de alta densidad. */
function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Barras de potencia por segundo coloreadas por zona, con bandas de zona
 * de fondo y, opcionalmente, la línea del objetivo.
 * opts: { ftp, zones, windowSec, targets (arreglo paralelo, W o null) }
 */
export function drawPowerBars(canvas, powers, opts) {
  const { ctx, w, h } = setup(canvas);
  const { ftp, zones } = opts;
  const windowSec = opts.windowSec || powers.length || 1;
  const data = powers.slice(-windowSec);
  const targets = opts.targets ? opts.targets.slice(-windowSec) : null;
  const maxData = Math.max(0, ...data, ...(targets || []).filter((x) => x != null));
  const yMax = Math.max(ftp * 1.5, maxData * 1.1, 100);
  const y = (watts) => h - (watts / yMax) * h;

  // Bandas de zona
  zones.forEach((z, i) => {
    const lo = (z.from / 100) * ftp;
    const hi = i < zones.length - 1 ? (zones[i + 1].from / 100) * ftp : yMax;
    ctx.fillStyle = hexA(z.color, 0.10);
    ctx.fillRect(0, y(hi), w, y(lo) - y(hi));
  });
  // Línea de FTP
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(0, y(ftp)); ctx.lineTo(w, y(ftp)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '10px system-ui'; ctx.fillText('FTP', 4, y(ftp) - 3);

  // Barras (si hay más datos que píxeles, se agrupan por promedio)
  const bw = w / windowSec;
  const step = Math.max(1, Math.floor(1 / bw));
  for (let i = 0; i < data.length; i += step) {
    let s = 0, k = 0;
    for (let j = i; j < Math.min(i + step, data.length); j++) { s += data[j]; k++; }
    const p = s / k;
    const zi = zoneIndexForPct(ftp > 0 ? (p / ftp) * 100 : 0, zones);
    ctx.fillStyle = zones[zi].color;
    const x = i * bw;
    ctx.fillRect(x, y(p), Math.max(1, bw * step + 0.5), h - y(p));
  }

  // Objetivo
  if (targets && targets.some((t) => t != null)) {
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath();
    let pen = false;
    targets.forEach((t, i) => {
      if (t == null) { pen = false; return; }
      const x = i * bw + bw / 2;
      if (!pen) { ctx.moveTo(x, y(t)); pen = true; } else ctx.lineTo(x, y(t));
    });
    ctx.stroke(); ctx.lineWidth = 1;
  }
}

/**
 * Perfil completo del entrenamiento (bloques coloreados por zona),
 * marcador de avance y potencia real superpuesta.
 * opts: { ftp, zones, progressSec, actual (arreglo W por segundo del entreno) }
 */
export function drawWorkoutProfile(canvas, expanded, opts) {
  const { ctx, w, h } = setup(canvas);
  const { ftp, zones } = opts;
  const total = expanded.total || 1;
  const maxPct = Math.max(130, ...expanded.segments.map((s) => Math.max(s.from || 0, s.to || 0) + 10));
  const x = (t) => (t / total) * w;
  const y = (pct) => h - (pct / maxPct) * h;

  for (const s of expanded.segments) {
    const isFree = s.from == null;
    const a = isFree ? 50 : s.from, b = isFree ? 50 : s.to;
    const zi = zoneIndexForPct((a + b) / 2, zones);
    ctx.fillStyle = isFree ? 'rgba(200,200,200,0.35)' : zones[zi].color;
    ctx.beginPath();
    ctx.moveTo(x(s.start), h);
    ctx.lineTo(x(s.start), y(a));
    ctx.lineTo(x(s.start + s.dur), y(b));
    ctx.lineTo(x(s.start + s.dur), h);
    ctx.closePath(); ctx.fill();
    if (s.test) { // marca del bloque de test
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui';
      ctx.fillText('TEST', x(s.start) + 3, h - 4);
    }
  }
  // Zona ya recorrida (oscurecida)
  if (opts.progressSec != null) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, x(Math.min(total, opts.progressSec)), h);
  }
  // Potencia real (línea)
  if (opts.actual && opts.actual.length && ftp > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.2; ctx.beginPath();
    const n = opts.actual.length;
    const step = Math.max(1, Math.floor(total / w));
    for (let i = 0; i < n; i += step) {
      let s = 0, k = 0;
      for (let j = i; j < Math.min(i + step, n); j++) { s += opts.actual[j]; k++; }
      const px = x(i), py = y(((s / k) / ftp) * 100);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke(); ctx.lineWidth = 1;
  }
  // Marcador de avance
  if (opts.progressSec != null) {
    const px = x(Math.min(total, opts.progressSec));
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke(); ctx.lineWidth = 1;
  }
}
