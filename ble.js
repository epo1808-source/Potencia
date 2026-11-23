// =====================================================================
// ble.js — Conexión Web Bluetooth con el sensor CSC (Suunto Bike Sensor)
// y lectura opcional de batería (servicio 0x180F).
//
// Eventos emitidos (EventTarget):
//   'status'      detail: { state, name, message }
//                 state = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
//   'measurement' detail: { data: objeto CSC decodificado, at: ms }
//   'feature'     detail: { wheel, crank, multiLocation }
//   'battery'     detail: { level }
// =====================================================================
import { parseCSCMeasurement, parseCSCFeature } from './csc.js';

const CSC_SERVICE = 0x1816;
const CSC_MEASUREMENT = 0x2A5B;
const CSC_FEATURE = 0x2A5C;
const BATTERY_SERVICE = 0x180F;
const BATTERY_LEVEL = 0x2A19;

const withTimeout = (p, ms, msg) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg || 'Tiempo de espera agotado')), ms)),
]);

export class CSCSensor extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.state = 'disconnected';
    this.feature = null;
    this.battery = null;
    this.userDisconnect = false;
    this.retry = 0;
    this._retryTimer = null;
    this._onDisconnected = this._onDisconnected.bind(this);
    this._onMeasurement = this._onMeasurement.bind(this);
    this._onBattery = this._onBattery.bind(this);
  }

  static get supported() { return !!(navigator.bluetooth && navigator.bluetooth.requestDevice); }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  _setState(state, message = '') {
    this.state = state;
    this._emit('status', { state, name: this.device ? this.device.name : '', message });
  }

  /** Abre el selector de Chrome (requiere un toque del usuario). */
  async requestAndConnect() {
    if (!CSCSensor.supported) throw new Error('Este navegador no soporta Web Bluetooth. Usa Chrome en Android.');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [CSC_SERVICE] }],
      optionalServices: [BATTERY_SERVICE],
    });
    await this._useDevice(device);
  }

  /**
   * Intenta reconectar a un sensor ya autorizado SIN abrir el selector.
   * Requiere navigator.bluetooth.getDevices(), que en Chrome Android puede
   * necesitar activar chrome://flags/#enable-web-bluetooth-new-permissions-backend
   */
  async tryRestore(savedId) {
    if (!navigator.bluetooth || !navigator.bluetooth.getDevices) return false;
    try {
      const devices = await navigator.bluetooth.getDevices();
      const dev = devices.find((d) => d.id === savedId) || (devices.length === 1 ? devices[0] : null);
      if (!dev) return false;
      // Esperar un anuncio del sensor antes de conectar (si está disponible)
      if (dev.watchAdvertisements) {
        const ac = new AbortController();
        const seen = new Promise((res) => dev.addEventListener('advertisementreceived', res, { once: true }));
        try { await dev.watchAdvertisements({ signal: ac.signal }); await withTimeout(seen, 8000); } catch (e) { /* seguimos igual */ }
        ac.abort();
      }
      await this._useDevice(dev);
      return true;
    } catch (e) {
      console.warn('No se pudo restaurar el sensor', e);
      this._setState('disconnected', 'Toca "Conectar" para elegir el sensor');
      return false;
    }
  }

  async _useDevice(device) {
    if (this.device && this.device !== device) this.disconnect();
    this.device = device;
    this.userDisconnect = false;
    device.removeEventListener('gattserverdisconnected', this._onDisconnected);
    device.addEventListener('gattserverdisconnected', this._onDisconnected);
    await this._connectGatt();
  }

  async _connectGatt() {
    this._setState(this.retry ? 'reconnecting' : 'connecting');
    const server = await withTimeout(this.device.gatt.connect(), 15000, 'El sensor no responde');
    const svc = await server.getPrimaryService(CSC_SERVICE);

    // Modo del sensor (velocidad, cadencia o ambos)
    try {
      const fc = await svc.getCharacteristic(CSC_FEATURE);
      this.feature = parseCSCFeature(await fc.readValue());
      this._emit('feature', this.feature);
    } catch (e) { console.warn('Sin csc_feature', e); }

    const mc = await svc.getCharacteristic(CSC_MEASUREMENT);
    mc.addEventListener('characteristicvaluechanged', this._onMeasurement);
    await mc.startNotifications();

    // Batería (opcional)
    try {
      const bs = await server.getPrimaryService(BATTERY_SERVICE);
      const bc = await bs.getCharacteristic(BATTERY_LEVEL);
      this.battery = (await bc.readValue()).getUint8(0);
      this._emit('battery', { level: this.battery });
      if (bc.properties.notify) {
        bc.addEventListener('characteristicvaluechanged', this._onBattery);
        await bc.startNotifications();
      }
    } catch (e) { /* el sensor no expone batería */ }

    this.retry = 0;
    this._setState('connected');
  }

  _onMeasurement(ev) {
    try {
      this._emit('measurement', { data: parseCSCMeasurement(ev.target.value), at: performance.now() });
    } catch (e) { console.warn('Paquete CSC inválido', e); }
  }

  _onBattery(ev) {
    this.battery = ev.target.value.getUint8(0);
    this._emit('battery', { level: this.battery });
  }

  /** Reconexión automática con espera creciente (1 s, 2 s, 4 s… máx. 15 s). */
  _onDisconnected() {
    if (this.userDisconnect || !this.device) { this._setState('disconnected'); return; }
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    clearTimeout(this._retryTimer);
    const wait = Math.min(15000, 1000 * 2 ** Math.min(this.retry, 4));
    this.retry++;
    this._setState('reconnecting', `Reintento ${this.retry} en ${Math.round(wait / 1000)} s`);
    this._retryTimer = setTimeout(async () => {
      if (this.userDisconnect || !this.device) return;
      try { await this._connectGatt(); } catch (e) {
        console.warn('Reconexión fallida', e);
        if (this.device && this.device.gatt.connected) { try { this.device.gatt.disconnect(); } catch (_) {} }
        this._scheduleReconnect();
      }
    }, wait);
  }

  disconnect() {
    this.userDisconnect = true;
    clearTimeout(this._retryTimer);
    if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
    this.retry = 0;
    this._setState('disconnected');
  }
}
