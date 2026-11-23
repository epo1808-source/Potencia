// =====================================================================
// fit.js — Codificador mínimo de archivos .FIT (Garmin Flexible and
// Interoperable Data Transfer) para actividades de ciclismo indoor.
//
// Se implementa a mano (sin dependencias) para que la app funcione sin
// conexión y sin paso de compilación. Estructura generada:
//   cabecera (14 bytes, con CRC) →
//   file_id → event(timer start) → record×N (+ event stop/start en
//   pausas) → event(timer stop_all) → lap → session → activity → CRC
//
// Todos los valores en little-endian. Escalas según el perfil FIT:
//   distancia: m×100 · velocidad: m/s×1000 · tiempos: s×1000
// =====================================================================

const FIT_EPOCH_OFFSET = 631065600; // segundos entre 1970-01-01 y 1989-12-31 UTC

// Tipos base FIT
const T = {
  enum: 0x00, uint8: 0x02, uint16: 0x84, uint32: 0x86, uint32z: 0x8C,
};
const SIZE = { 0x00: 1, 0x02: 1, 0x84: 2, 0x86: 4, 0x8C: 4 };
const INVALID = { 0x00: 0xFF, 0x02: 0xFF, 0x84: 0xFFFF, 0x86: 0xFFFFFFFF, 0x8C: 0 };

// Tabla de CRC-16 de Garmin (por nibbles)
const CRC_TABLE = [
  0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
  0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
];
export function fitCrc(bytes, start = 0, end = bytes.length, crc = 0) {
  for (let i = start; i < end; i++) {
    const b = bytes[i];
    let tmp = CRC_TABLE[crc & 0xF];
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ CRC_TABLE[b & 0xF];
    tmp = CRC_TABLE[crc & 0xF];
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xF];
  }
  return crc;
}

/** Convierte Date/ms a marca de tiempo FIT. */
export function fitTime(ms) { return Math.round(ms / 1000) - FIT_EPOCH_OFFSET; }

// Definiciones de mensajes: [número global, [[campo, tipo], ...]]
const MSG = {
  file_id:  { num: 0,  local: 0, fields: [['type', 0, T.enum], ['manufacturer', 1, T.uint16], ['product', 2, T.uint16], ['serial', 3, T.uint32z], ['time_created', 4, T.uint32]] },
  event:    { num: 21, local: 1, fields: [['timestamp', 253, T.uint32], ['event', 0, T.enum], ['event_type', 1, T.enum], ['event_group', 4, T.uint8]] },
  record:   { num: 20, local: 2, fields: [['timestamp', 253, T.uint32], ['distance', 5, T.uint32], ['speed', 6, T.uint16], ['power', 7, T.uint16], ['cadence', 4, T.uint8]] },
  lap:      { num: 19, local: 3, fields: [
    ['timestamp', 253, T.uint32], ['message_index', 254, T.uint16], ['event', 0, T.enum], ['event_type', 1, T.enum],
    ['start_time', 2, T.uint32], ['total_elapsed_time', 7, T.uint32], ['total_timer_time', 8, T.uint32],
    ['total_distance', 9, T.uint32], ['total_calories', 11, T.uint16], ['avg_speed', 13, T.uint16], ['max_speed', 14, T.uint16],
    ['avg_cadence', 17, T.uint8], ['max_cadence', 18, T.uint8], ['avg_power', 19, T.uint16], ['max_power', 20, T.uint16],
    ['lap_trigger', 24, T.enum], ['sport', 25, T.enum], ['normalized_power', 33, T.uint16], ['sub_sport', 39, T.enum], ['total_work', 41, T.uint32]] },
  session:  { num: 18, local: 4, fields: [
    ['timestamp', 253, T.uint32], ['message_index', 254, T.uint16], ['event', 0, T.enum], ['event_type', 1, T.enum],
    ['start_time', 2, T.uint32], ['sport', 5, T.enum], ['sub_sport', 6, T.enum],
    ['total_elapsed_time', 7, T.uint32], ['total_timer_time', 8, T.uint32], ['total_distance', 9, T.uint32],
    ['total_calories', 11, T.uint16], ['avg_speed', 14, T.uint16], ['max_speed', 15, T.uint16],
    ['avg_cadence', 18, T.uint8], ['max_cadence', 19, T.uint8], ['avg_power', 20, T.uint16], ['max_power', 21, T.uint16],
    ['first_lap_index', 25, T.uint16], ['num_laps', 26, T.uint16], ['trigger', 28, T.enum],
    ['normalized_power', 34, T.uint16], ['training_stress_score', 35, T.uint16], ['intensity_factor', 36, T.uint16],
    ['threshold_power', 45, T.uint16], ['total_work', 48, T.uint32]] },
  activity: { num: 34, local: 5, fields: [['timestamp', 253, T.uint32], ['total_timer_time', 0, T.uint32], ['num_sessions', 1, T.uint16], ['type', 2, T.enum], ['event', 3, T.enum], ['event_type', 4, T.enum], ['local_timestamp', 5, T.uint32]] },
};

// Valores de enumeraciones del perfil FIT
const E = {
  FILE_ACTIVITY: 4, MANUFACTURER_DEVELOPMENT: 255,
  EVENT_TIMER: 0, EVENT_LAP: 9, EVENT_SESSION: 8, EVENT_ACTIVITY: 26,
  TYPE_START: 0, TYPE_STOP: 1, TYPE_STOP_ALL: 4,
  SPORT_CYCLING: 2, SUBSPORT_INDOOR_CYCLING: 6,
  LAP_TRIGGER_SESSION_END: 7, SESSION_TRIGGER_ACTIVITY_END: 0, ACTIVITY_MANUAL: 0,
};

/** Escritor binario que crece dinámicamente. */
class ByteWriter {
  constructor() { this.buf = new Uint8Array(65536); this.len = 0; }
  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const nb = new Uint8Array(size); nb.set(this.buf.subarray(0, this.len)); this.buf = nb;
  }
  u8(v) { this.ensure(1); this.buf[this.len++] = v & 0xFF; }
  u16(v) { this.u8(v); this.u8(v >>> 8); }
  u32(v) { this.u16(v & 0xFFFF); this.u16(v >>> 16); }
  bytes() { return this.buf.subarray(0, this.len); }
}

class FitWriter {
  constructor() { this.w = new ByteWriter(); this.defined = new Set(); }

  define(def) {
    const w = this.w;
    w.u8(0x40 | def.local);       // cabecera de mensaje de definición
    w.u8(0);                      // reservado
    w.u8(0);                      // arquitectura: little-endian
    w.u16(def.num);               // número global del mensaje
    w.u8(def.fields.length);
    for (const [, fnum, type] of def.fields) { w.u8(fnum); w.u8(SIZE[type]); w.u8(type); }
    this.defined.add(def.local);
  }

  write(name, values) {
    const def = MSG[name];
    if (!this.defined.has(def.local)) this.define(def);
    const w = this.w;
    w.u8(def.local);              // cabecera de mensaje de datos
    for (const [key, , type] of def.fields) {
      let v = values[key];
      if (v == null || !isFinite(v)) v = INVALID[type];
      v = Math.round(v);
      const max = INVALID[type] === 0 ? 0xFFFFFFFF : INVALID[type];
      if (v < 0) v = INVALID[type]; else if (v > max) v = max - 1;
      if (SIZE[type] === 1) w.u8(v); else if (SIZE[type] === 2) w.u16(v); else w.u32(v);
    }
  }

  /** Devuelve el archivo completo: cabecera + datos + CRC. */
  finish() {
    const data = this.w.bytes();
    const out = new Uint8Array(14 + data.length + 2);
    const dv = new DataView(out.buffer);
    out[0] = 14;                          // tamaño de cabecera
    out[1] = 0x20;                        // versión de protocolo 2.0
    dv.setUint16(2, 21222, true);         // versión de perfil 21.222
    dv.setUint32(4, data.length, true);   // tamaño de datos
    out[8] = 0x2E; out[9] = 0x46; out[10] = 0x49; out[11] = 0x54; // ".FIT"
    dv.setUint16(12, fitCrc(out, 0, 12), true);                   // CRC de cabecera
    out.set(data, 14);
    dv.setUint16(14 + data.length, fitCrc(out, 0, 14 + data.length), true); // CRC de archivo
    return out;
  }
}

/**
 * Genera un .FIT de actividad indoor cycling.
 * @param {object} s  sesión: { startMs, endMs, samples:{ts,p,v,c,d}, summary, ftp }
 *   samples.ts = hora real (ms) de cada segundo registrado
 *   samples.v  = km/h, samples.d = metros acumulados, samples.c = rpm o null
 * @returns {Uint8Array}
 */
export function encodeFit(s) {
  const f = new FitWriter();
  const S = s.samples;
  const n = S.p.length;
  const start = fitTime(s.startMs);
  const end = fitTime(s.endMs || (n ? S.ts[n - 1] + 1000 : s.startMs));
  const sum = s.summary || {};
  const timerSec = n;                                   // segundos activos
  const elapsedSec = Math.max(timerSec, end - start);
  const dist = n ? S.d[n - 1] : 0;
  const avgSpeed = timerSec ? dist / timerSec : 0;      // m/s
  const tzOffset = -new Date(s.startMs).getTimezoneOffset() * 60;

  f.write('file_id', { type: E.FILE_ACTIVITY, manufacturer: E.MANUFACTURER_DEVELOPMENT, product: 1, serial: 12345 + (start % 100000), time_created: start });
  f.write('event', { timestamp: start, event: E.EVENT_TIMER, event_type: E.TYPE_START, event_group: 0 });

  let prevT = null;
  for (let i = 0; i < n; i++) {
    const t = fitTime(S.ts[i]);
    // Hueco de más de 2 s → hubo pausa: registramos stop/start del cronómetro.
    if (prevT != null && t - prevT > 2) {
      f.write('event', { timestamp: prevT, event: E.EVENT_TIMER, event_type: E.TYPE_STOP_ALL, event_group: 0 });
      f.write('event', { timestamp: t, event: E.EVENT_TIMER, event_type: E.TYPE_START, event_group: 0 });
    }
    f.write('record', {
      timestamp: t,
      distance: S.d[i] * 100,
      speed: (S.v[i] / 3.6) * 1000,
      power: S.p[i],
      cadence: S.c[i] == null ? null : S.c[i],
    });
    prevT = t;
  }

  f.write('event', { timestamp: end, event: E.EVENT_TIMER, event_type: E.TYPE_STOP_ALL, event_group: 0 });

  const common = {
    timestamp: end, start_time: start, message_index: 0,
    total_elapsed_time: elapsedSec * 1000, total_timer_time: timerSec * 1000,
    total_distance: dist * 100, total_calories: sum.kj, // kcal ≈ kJ mecánicos (eficiencia ~24 %)
    avg_speed: avgSpeed * 1000, max_speed: (sum.maxSpeed || 0) / 3.6 * 1000,
    avg_cadence: sum.avgCadence || null, max_cadence: sum.maxCadence || null,
    avg_power: sum.avgPower, max_power: sum.maxPower, normalized_power: sum.np,
    sport: E.SPORT_CYCLING, sub_sport: E.SUBSPORT_INDOOR_CYCLING,
    total_work: (sum.kj || 0) * 1000,
  };
  f.write('lap', { ...common, event: E.EVENT_LAP, event_type: E.TYPE_STOP, lap_trigger: E.LAP_TRIGGER_SESSION_END });
  f.write('session', {
    ...common, event: E.EVENT_SESSION, event_type: E.TYPE_STOP,
    first_lap_index: 0, num_laps: 1, trigger: E.SESSION_TRIGGER_ACTIVITY_END,
    training_stress_score: (sum.tss || 0) * 10, intensity_factor: (sum.IF || 0) * 1000,
    threshold_power: s.ftp,
  });
  f.write('activity', {
    timestamp: end, total_timer_time: timerSec * 1000, num_sessions: 1,
    type: E.ACTIVITY_MANUAL, event: E.EVENT_ACTIVITY, event_type: E.TYPE_STOP,
    local_timestamp: end + tzOffset,
  });
  return f.finish();
}
