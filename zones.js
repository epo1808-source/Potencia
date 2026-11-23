// =====================================================================
// zones.js — Zonas de potencia (6 de Zwift o 7 de Coggan).
// Cada zona se define por su límite INFERIOR en % del FTP.
// =====================================================================

export const ZONE_PRESETS = {
  zwift: [
    { name: 'Recuperación', from: 0,   color: '#7f8a99' },
    { name: 'Resistencia',  from: 60,  color: '#2f8ae6' },
    { name: 'Tempo',        from: 76,  color: '#3fbf5f' },
    { name: 'Umbral',       from: 90,  color: '#f5c518' },
    { name: 'VO2máx',       from: 105, color: '#ff7a1a' },
    { name: 'Anaeróbico',   from: 119, color: '#ff3b30' },
  ],
  coggan: [
    { name: 'Recuperación activa', from: 0,   color: '#7f8a99' },
    { name: 'Resistencia',         from: 56,  color: '#2f8ae6' },
    { name: 'Tempo',               from: 76,  color: '#3fbf5f' },
    { name: 'Umbral de lactato',   from: 91,  color: '#f5c518' },
    { name: 'VO2máx',              from: 106, color: '#ff7a1a' },
    { name: 'Capacidad anaeróbica',from: 121, color: '#ff3b30' },
    { name: 'Neuromuscular',       from: 151, color: '#b04ad9' },
  ],
};

/** Copia profunda de un preset (para editarlo sin tocar el original). */
export function presetZones(type) {
  return JSON.parse(JSON.stringify(ZONE_PRESETS[type] || ZONE_PRESETS.zwift));
}

/** Índice de zona (0..n-1) para un % de FTP. */
export function zoneIndexForPct(pct, zones) {
  let idx = 0;
  for (let i = 0; i < zones.length; i++) if (pct >= zones[i].from) idx = i;
  return idx;
}

/** Info completa de la zona actual para la potencia dada. */
export function zoneInfo(watts, ftp, zones) {
  const pct = ftp > 0 ? (watts / ftp) * 100 : 0;
  const i = zoneIndexForPct(pct, zones);
  const lo = zones[i].from;
  const hi = i < zones.length - 1 ? zones[i + 1].from : lo + 30;
  const pos = Math.max(0, Math.min(1, (pct - lo) / (hi - lo)));
  return { index: i, number: i + 1, pct, pos, ...zones[i], lo, hi };
}

/** Texto del rango de una zona, p. ej. "76–89 %". */
export function zoneRangeText(zones, i) {
  const lo = zones[i].from;
  if (i === 0) return `< ${zones[1].from} %`;
  if (i === zones.length - 1) return `> ${lo - 1} %`;
  return `${lo}–${zones[i + 1].from - 1} %`;
}

/** Valida que los límites sean crecientes. */
export function validZones(zones) {
  if (!zones.length || zones[0].from !== 0) return false;
  for (let i = 1; i < zones.length; i++) if (!(zones[i].from > zones[i - 1].from)) return false;
  return true;
}
