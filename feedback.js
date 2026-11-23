// =====================================================================
// feedback.js — Sonidos (Web Audio API), vibración (Vibration API) y
// bloqueo de pantalla encendida (Screen Wake Lock API).
// =====================================================================

let ctx = null;
export const prefs = { sound: true, vibration: true };

/** Debe llamarse desde un toque del usuario (política de autoplay). */
export function unlockAudio() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) { /* sin audio */ }
}

export function beep(freq = 880, ms = 150, vol = 0.25) {
  if (!prefs.sound || !ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
  o.connect(g).connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + ms / 1000 + 0.02);
}

export function vibrate(pattern) {
  if (!prefs.vibration || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch (e) {}
}

/** Cuenta regresiva: 3, 2, 1 → tono corto + vibración corta. */
export function countdownTick(n) { beep(n > 0 ? 660 : 990, n > 0 ? 120 : 400); vibrate(n > 0 ? 80 : [200, 80, 200]); }

// ---------- Wake Lock ----------
let wakeLock = null;
let wantLock = false;

export async function keepScreenOn(on) {
  wantLock = on;
  if (!('wakeLock' in navigator)) return false;
  try {
    if (on && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release(); wakeLock = null;
    }
    return true;
  } catch (e) { console.warn('Wake Lock no disponible', e); return false; }
}

// Chrome libera el bloqueo al ocultar la pestaña: lo pedimos de nuevo al volver.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantLock && !wakeLock) keepScreenOn(true);
});
