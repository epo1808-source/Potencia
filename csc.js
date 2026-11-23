// =====================================================================
// csc.js — Decodificación del perfil Bluetooth "Cycling Speed and
// Cadence" (CSC) y cálculo de velocidad y cadencia.
//
// Paquete 0x2A5B (csc_measurement), little-endian:
//   byte 0      : flags  (bit0 = hay datos de rueda, bit1 = hay datos de biela)
//   si bit0     : uint32 revoluciones acumuladas de rueda
//                 uint16 tiempo del último evento de rueda (1/1024 s)
//   si bit1     : uint16 revoluciones acumuladas de biela
//                 uint16 tiempo del último evento de biela (1/1024 s)
//
// Característica 0x2A5C (csc_feature), uint16:
//   bit0 = soporta revoluciones de rueda (velocidad)
//   bit1 = soporta revoluciones de biela (cadencia)
//   bit2 = múltiples ubicaciones del sensor
// =====================================================================

/** Decodifica un paquete csc_measurement. Recibe un DataView. */
export function parseCSCMeasurement(dv) {
  const flags = dv.getUint8(0);
  let o = 1;
  const out = { flags };
  if (flags & 0x01) {
    out.wheelRevs = dv.getUint32(o, true); o += 4;
    out.wheelTime = dv.getUint16(o, true); o += 2;
  }
  if (flags & 0x02) {
    out.crankRevs = dv.getUint16(o, true); o += 2;
    out.crankTime = dv.getUint16(o, true); o += 2;
  }
  return out;
}

/** Decodifica csc_feature (uint16) en un objeto legible. */
export function parseCSCFeature(dv) {
  const f = dv.getUint16(0, true);
  return {
    raw: f,
    wheel: !!(f & 0x01),
    crank: !!(f & 0x02),
    multiLocation: !!(f & 0x04),
  };
}

/** Diferencia con desbordamiento (rollover) para contadores sin signo. */
export function deltaWrap(cur, prev, modulo) {
  return (cur - prev + modulo) % modulo;
}

const U16 = 0x10000;
const U32 = 0x100000000;

/**
 * Calculadora de velocidad/cadencia a partir de paquetes CSC sucesivos.
 * - Maneja el desbordamiento de contadores y tiempos.
 * - Si no llega una revolución nueva en `timeoutMs` (3 s), el valor pasa a 0.
 * - Si el sensor nunca envía datos de biela, la cadencia queda en null ("--").
 */
export class CSCCalculator {
  constructor({ getCircumferenceMm, timeoutMs = 3000 } = {}) {
    this.getCirc = getCircumferenceMm || (() => 2096);
    this.timeoutMs = timeoutMs;
    this.reset();
  }

  reset() {
    this.prevWheel = null;   // {revs, time, rxMs}
    this.prevCrank = null;
    this.speedKmh = 0;
    this.cadence = null;     // null = el sensor no transmite cadencia
    this.hasWheel = false;
    this.hasCrank = false;
    this.lastWheelEventMs = 0;
    this.lastCrankEventMs = 0;
    this.totalWheelRevs = 0; // revoluciones válidas acumuladas (diagnóstico)
  }

  /** Procesa una medición decodificada. `nowMs` = hora de recepción. */
  update(m, nowMs = performance.now()) {
    if (m.wheelRevs !== undefined) this._updateWheel(m, nowMs);
    if (m.crankRevs !== undefined) this._updateCrank(m, nowMs);
  }

  _updateWheel(m, nowMs) {
    this.hasWheel = true;
    const p = this.prevWheel;
    // Si la brecha entre paquetes supera 60 s (reconexión, etc.), los
    // tiempos de 16 bits (máx. 64 s) son ambiguos: re-sincronizamos.
    if (!p || nowMs - p.rxMs > 60000) {
      this.prevWheel = { revs: m.wheelRevs, time: m.wheelTime, rxMs: nowMs };
      return;
    }
    const dRevs = deltaWrap(m.wheelRevs, p.revs, U32);
    const dTicks = deltaWrap(m.wheelTime, p.time, U16);

    if (dRevs === 0 || dTicks === 0) {
      // Sin evento nuevo: el sensor repite el último. Solo actualizamos rxMs.
      p.rxMs = nowMs;
      return;
    }
    // Protección contra reinicios del sensor (saltos absurdos).
    if (dRevs > 200) {
      this.prevWheel = { revs: m.wheelRevs, time: m.wheelTime, rxMs: nowMs };
      return;
    }
    const dt = dTicks / 1024;                       // segundos
    const metros = dRevs * (this.getCirc() / 1000);  // circunferencia en m
    const kmh = (metros / dt) * 3.6;
    if (kmh <= 120) {                                // descarta lecturas imposibles
      this.speedKmh = kmh;
      this.lastWheelEventMs = nowMs;
      this.totalWheelRevs += dRevs;
    }
    this.prevWheel = { revs: m.wheelRevs, time: m.wheelTime, rxMs: nowMs };
  }

  _updateCrank(m, nowMs) {
    this.hasCrank = true;
    if (this.cadence === null) this.cadence = 0;
    const p = this.prevCrank;
    if (!p || nowMs - p.rxMs > 60000) {
      this.prevCrank = { revs: m.crankRevs, time: m.crankTime, rxMs: nowMs };
      return;
    }
    const dRevs = deltaWrap(m.crankRevs, p.revs, U16);
    const dTicks = deltaWrap(m.crankTime, p.time, U16);
    if (dRevs === 0 || dTicks === 0) { p.rxMs = nowMs; return; }
    if (dRevs > 50) {
      this.prevCrank = { revs: m.crankRevs, time: m.crankTime, rxMs: nowMs };
      return;
    }
    const rpm = (dRevs / (dTicks / 1024)) * 60;
    if (rpm <= 220) {
      this.cadence = rpm;
      this.lastCrankEventMs = nowMs;
    }
    this.prevCrank = { revs: m.crankRevs, time: m.crankTime, rxMs: nowMs };
  }

  /** Llamar periódicamente: aplica el timeout de 3 s (velocidad/cadencia a 0). */
  tick(nowMs = performance.now()) {
    if (this.speedKmh > 0 && nowMs - this.lastWheelEventMs > this.timeoutMs) this.speedKmh = 0;
    if (this.hasCrank && this.cadence > 0 && nowMs - this.lastCrankEventMs > this.timeoutMs) this.cadence = 0;
  }
}
