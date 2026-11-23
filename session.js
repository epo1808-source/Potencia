// =====================================================================
// session.js — Grabador de la sesión: registra una muestra por segundo,
// gestiona pausa/autopausa, avance del entrenamiento estructurado,
// métricas acumuladas y los datos del test de FTP.
// =====================================================================
import { Metrics } from './metrics.js';
import { expandWorkout, targetAt } from './workouts.js';

export class Recorder {
  constructor() { this.state = 'idle'; }

  /**
   * @param {object} o { workout|null, ftp, zones, zoneType, autopause }
   */
  start(o) {
    this.state = 'running';
    this.autopaused = false;
    this.startMs = Date.now();
    this.endMs = null;
    this.ftp = o.ftp;
    this.zones = o.zones;
    this.zoneType = o.zoneType;
    this.autopause = o.autopause;
    this.workout = o.workout || null;
    this.expanded = this.workout ? expandWorkout(this.workout) : null;
    this.samples = { ts: [], p: [], v: [], c: [], d: [] };
    this.metrics = new Metrics();
    this.distance = 0;
    this.testPowers = [];
    this.wallSec = 0;
  }

  get elapsed() { return this.samples ? this.samples.p.length : 0; }
  get running() { return this.state === 'running'; }
  get active() { return this.state === 'running' || this.state === 'paused'; }

  pause() { if (this.state === 'running') this.state = 'paused'; }
  resume() { if (this.state === 'paused') this.state = 'running'; }

  /** Estado del entrenamiento en el segundo actual. */
  workoutInfo() {
    if (!this.expanded) return null;
    return targetAt(this.expanded, this.elapsed);
  }

  /** Objetivo actual en vatios (o null). */
  targetWatts() {
    const info = this.workoutInfo();
    return info && info.pct != null ? (info.pct / 100) * this.ftp : null;
  }

  /**
   * Registra un segundo. Devuelve true si se grabó la muestra.
   * @param {number} p W · @param {number} kmh · @param {number|null} cad rpm
   */
  tick(p, kmh, cad, nowMs = Date.now()) {
    if (!this.active) return false;
    this.wallSec++;
    if (this.state !== 'running') return false;
    if (this.autopause && kmh <= 0) { this.autopaused = true; return false; }
    this.autopaused = false;

    const info = this.workoutInfo();
    if (info && info.seg.test) this.testPowers.push(p);

    this.distance += kmh / 3.6; // m recorridos en 1 s
    const S = this.samples;
    S.ts.push(nowMs); S.p.push(Math.round(p)); S.v.push(+kmh.toFixed(2));
    S.c.push(cad == null ? null : Math.round(cad)); S.d.push(+this.distance.toFixed(2));
    this.metrics.add(p, cad, kmh, this.ftp, this.zones);
    return true;
  }

  /** Resultado del test de FTP (si aplica). */
  ftpTestResult() {
    if (!this.workout || !this.workout.ftpTest || !this.testPowers.length) return null;
    const avg = this.testPowers.reduce((a, b) => a + b, 0) / this.testPowers.length;
    return {
      seconds: this.testPowers.length,
      avg20: Math.round(avg),
      ftp: Math.round(avg * 0.95),
      complete: this.testPowers.length >= 20 * 60 - 5,
    };
  }

  finish() {
    this.state = 'finished';
    this.endMs = Date.now();
    return this.toSession();
  }

  /** Objeto de sesión serializable (resumen + muestras). */
  toSession() {
    const summary = this.metrics.summary(this.ftp);
    summary.distance = Math.round(this.distance);
    return {
      id: 's-' + this.startMs,
      startMs: this.startMs,
      endMs: this.endMs || Date.now(),
      name: this.workout ? this.workout.name : 'Rodaje libre',
      ftp: this.ftp,
      zoneType: this.zoneType,
      zones: this.zones,
      summary,
      ftpTest: this.ftpTestResult(),
      samples: this.samples,
    };
  }
}
