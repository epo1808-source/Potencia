// =====================================================================
// metrics.js — Métricas de entrenamiento calculadas segundo a segundo:
// potencia promedio y máxima, NP, IF, TSS, kJ y tiempo por zona.
// =====================================================================
import { zoneIndexForPct } from './zones.js';

export class Metrics {
  constructor() { this.reset(); }

  reset() {
    this.n = 0;           // segundos registrados
    this.sumP = 0;
    this.maxP = 0;
    this.sumCad = 0; this.nCad = 0; this.maxCad = 0;
    this.maxSpeed = 0;
    this.joules = 0;
    this.win = [];        // ventana de 30 s para NP
    this.winSum = 0;
    this.sum4 = 0;        // suma de (prom30s)^4
    this.n4 = 0;
    this.zoneSec = [];
  }

  /** Agrega una muestra de 1 segundo. */
  add(p, cad, kmh, ftp, zones) {
    this.n++;
    this.sumP += p;
    this.joules += p;                       // 1 s × W = J
    if (p > this.maxP) this.maxP = p;
    if (cad != null && cad > 0) { this.sumCad += cad; this.nCad++; if (cad > this.maxCad) this.maxCad = cad; }
    if (kmh > this.maxSpeed) this.maxSpeed = kmh;

    // NP: promedio móvil de 30 s, elevado a la 4ª, promediado y raíz 4ª.
    this.win.push(p); this.winSum += p;
    if (this.win.length > 30) this.winSum -= this.win.shift();
    if (this.win.length === 30) {
      const a = this.winSum / 30;
      this.sum4 += a ** 4; this.n4++;
    }

    // Tiempo en zona
    if (zones) {
      const z = zoneIndexForPct(ftp > 0 ? (p / ftp) * 100 : 0, zones);
      while (this.zoneSec.length < zones.length) this.zoneSec.push(0);
      this.zoneSec[z]++;
    }
  }

  get avgP() { return this.n ? this.sumP / this.n : 0; }
  get avgCad() { return this.nCad ? this.sumCad / this.nCad : 0; }
  get np() { return this.n4 ? Math.pow(this.sum4 / this.n4, 0.25) : this.avgP; }
  get kj() { return this.joules / 1000; }
  IF(ftp) { return ftp > 0 ? this.np / ftp : 0; }
  TSS(ftp) {
    if (!(ftp > 0) || !this.n) return 0;
    const IF = this.IF(ftp);
    return (this.n * this.np * IF) / (ftp * 3600) * 100;
  }

  /** Resumen serializable. */
  summary(ftp) {
    return {
      seconds: this.n,
      avgPower: Math.round(this.avgP),
      maxPower: Math.round(this.maxP),
      np: Math.round(this.np),
      IF: +this.IF(ftp).toFixed(3),
      tss: +this.TSS(ftp).toFixed(1),
      kj: Math.round(this.kj),
      avgCadence: Math.round(this.avgCad),
      maxCadence: Math.round(this.maxCad),
      maxSpeed: +this.maxSpeed.toFixed(2),
      zoneSeconds: this.zoneSec.slice(),
    };
  }
}

/** Recalcula métricas completas a partir de arreglos por segundo. */
export function metricsFromSamples(samples, ftp, zones) {
  const m = new Metrics();
  for (let i = 0; i < samples.p.length; i++) {
    m.add(samples.p[i], samples.c[i], samples.v[i], ftp, zones);
  }
  return m;
}
