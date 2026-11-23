// =====================================================================
// simulator.js — Modo "Demo": genera paquetes CSC binarios ficticios
// (igual que el sensor real) para probar toda la cadena sin bicicleta.
// Los contadores arrancan cerca del desbordamiento para probar el rollover.
// Si hay un entrenamiento activo, sigue el objetivo con algo de ruido.
// =====================================================================
import { speedForPower } from './power.js';

export class Simulator extends EventTarget {
  constructor({ getCircumferenceMm, getCurve, getTargetWatts, getFtp }) {
    super();
    this.getCirc = getCircumferenceMm;
    this.getCurve = getCurve;
    this.getTarget = getTargetWatts;
    this.getFtp = getFtp;
    this.timer = null;
  }

  start() {
    // Contadores cerca del máximo para forzar rollover en los primeros segundos
    this.wheelRevs = 0xFFFFFFFF - 5; // uint32
    this.wheelPos = this.wheelRevs;  // posición continua (revoluciones)
    this.crankRevs = 0xFFFF - 3;     // uint16
    this.crankPos = this.crankRevs;
    this.t0 = performance.now();
    this.wheelEvt = 65000;           // 1/1024 s, cerca de 65535
    this.crankEvt = 65100;
    this.lastMs = this.t0;
    this.phase = 0;
    this.stopPedalUntil = 0;
    this.timer = setInterval(() => this._step(), 1000);
    this.dispatchEvent(new CustomEvent('status', { detail: { state: 'connected', name: 'Simulador' } }));
    this.dispatchEvent(new CustomEvent('feature', { detail: { wheel: true, crank: true } }));
    this.dispatchEvent(new CustomEvent('battery', { detail: { level: 87 } }));
  }

  stop() {
    clearInterval(this.timer); this.timer = null;
    this.dispatchEvent(new CustomEvent('status', { detail: { state: 'disconnected', name: '' } }));
  }

  get running() { return !!this.timer; }

  /** Simula dejar de pedalear unos segundos (prueba de autopausa). */
  pauseFor(sec) { this.stopPedalUntil = performance.now() + sec * 1000; }

  _targetSpeed() {
    const ftp = this.getFtp() || 200;
    let watts = this.getTarget();
    if (watts == null) {
      // Sin objetivo: ondas suaves entre ~55 % y ~105 % del FTP
      this.phase += 1;
      watts = ftp * (0.8 + 0.25 * Math.sin(this.phase / 45) + 0.08 * Math.sin(this.phase / 7));
    }
    watts *= 1 + (Math.random() - 0.5) * 0.08; // ruido ±4 %
    return speedForPower(watts, this.getCurve());
  }

  _step() {
    const now = performance.now();
    const dtS = (now - this.lastMs) / 1000;
    this.lastMs = now;
    const tick = (ms) => Math.round(((ms - this.t0) / 1000) * 1024);
    const stopped = now < this.stopPedalUntil;

    const kmh = stopped ? 0 : this._targetSpeed();
    const rpm = stopped ? 0 : 88 + Math.random() * 8;

    // Rueda: avanzamos la posición continua y calculamos cuándo ocurrió la última revolución completa
    const revRate = (kmh / 3.6) / (this.getCirc() / 1000); // rev/s
    const prevWhole = Math.floor(this.wheelPos);
    this.wheelPos += revRate * dtS;
    const whole = Math.floor(this.wheelPos);
    if (whole > prevWhole && revRate > 0) {
      const frac = this.wheelPos - whole;
      this.wheelEvt = (65000 + tick(now - (frac / revRate) * 1000)) & 0xFFFF;
    }
    const crankRate = rpm / 60;
    const prevC = Math.floor(this.crankPos);
    this.crankPos += crankRate * dtS;
    const wc = Math.floor(this.crankPos);
    if (wc > prevC && crankRate > 0) {
      const frac = this.crankPos - wc;
      this.crankEvt = (65100 + tick(now - (frac / crankRate) * 1000)) & 0xFFFF;
    }

    // Paquete binario CSC: flags=0x03 (rueda + biela)
    const dv = new DataView(new ArrayBuffer(11));
    dv.setUint8(0, 0x03);
    dv.setUint32(1, whole % 0x100000000, true);
    dv.setUint16(5, this.wheelEvt, true);
    dv.setUint16(7, wc % 0x10000, true);
    dv.setUint16(9, this.crankEvt, true);
    this.dispatchEvent(new CustomEvent('packet', { detail: { dv, at: now } }));
  }
}
