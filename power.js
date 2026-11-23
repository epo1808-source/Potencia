// =====================================================================
// power.js — Potencia virtual del CycleOps Fluid 2.
//
// Curva publicada (velocidad en mph):  P(W) = 8.9064·v + 0.0098·v³
// La app trabaja en km/h y convierte internamente.
// Coeficientes (a, b) y factor de calibración (±20 %) son configurables.
// =====================================================================

export const KMH_TO_MPH = 0.621371192;
export const MAX_POWER = 1500;

export const DEFAULT_CURVE = { a: 8.9064, b: 0.0098, calPct: 0 };

/** Potencia (W) a partir de la velocidad en km/h. */
export function powerFromSpeed(kmh, curve = DEFAULT_CURVE) {
  if (!kmh || kmh <= 0) return 0;
  const v = kmh * KMH_TO_MPH;
  const factor = 1 + (Number(curve.calPct) || 0) / 100;
  const p = (curve.a * v + curve.b * v * v * v) * factor;
  return Math.max(0, Math.min(MAX_POWER, p));
}

/** Inversa (para el simulador): velocidad en km/h que produce `watts`. */
export function speedForPower(watts, curve = DEFAULT_CURVE) {
  if (watts <= 0) return 0;
  const factor = 1 + (Number(curve.calPct) || 0) / 100;
  const target = watts / factor;
  let v = 15; // mph, punto de partida de Newton-Raphson
  for (let i = 0; i < 30; i++) {
    const f = curve.a * v + curve.b * v ** 3 - target;
    const df = curve.a + 3 * curve.b * v * v;
    const nv = v - f / df;
    if (Math.abs(nv - v) < 1e-6) { v = nv; break; }
    v = Math.max(0, nv);
  }
  return v / KMH_TO_MPH;
}

/** Promedio móvil sobre las últimas N muestras de 1 s. */
export function rollingAvg(arr, n) {
  if (!arr.length) return 0;
  const k = Math.min(n, arr.length);
  let s = 0;
  for (let i = arr.length - k; i < arr.length; i++) s += arr[i];
  return s / k;
}
