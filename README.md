# Potencia Virtual – Rodillo CycleOps Fluid 2

PWA en español que calcula la **potencia virtual** a partir de la velocidad de la rueda medida por un sensor Bluetooth CSC (Suunto Bike Sensor) sobre un rodillo **CycleOps Fluid 2**. Muestra potencia y zonas en tiempo real, permite hacer entrenamientos estructurados y el test de FTP, guarda el historial y exporta a Garmin Connect (.FIT y .TCX).

Sin frameworks, sin paso de compilación y sin dependencias: HTML + CSS + JavaScript (módulos ES nativos).

---

## 1. Puntos técnicos a tener en cuenta (y cómo se resolvieron)

| Punto | Situación en Chrome Android | Solución aplicada |
|---|---|---|
| **Ubicación del sensor** | En un rodillo la rueda delantera no gira. | El Suunto Bike Sensor debe ir en el **buje de la rueda trasera** (modo velocidad). Si el sensor informa que solo está en modo cadencia, la app muestra un aviso. Con un único sensor en modo velocidad, lo normal es que **no transmita cadencia**: la app la muestra como `--` sin errores. |
| **Reconexión automática** | Mientras la app está abierta funciona bien. Al **volver a abrir la app**, Chrome exige un toque del usuario para elegir el sensor, salvo que esté activo `getDevices()`. | Reintentos automáticos con espera creciente (1, 2, 4, 8 y 15 s) durante la sesión. Al abrir la app se intenta una reconexión silenciosa con `getDevices()`; si Chrome no la permite, basta con tocar **Conectar**. Para habilitarla: `chrome://flags/#enable-web-bluetooth-new-permissions-backend` → *Enabled* (opcional, experimental). |
| **App en segundo plano / pantalla apagada** | Chrome pausa JavaScript y puede cortar el Bluetooth. | Screen Wake Lock mantiene la pantalla encendida durante la sesión (se vuelve a pedir al regresar a la app). Si los temporizadores se retrasan, el bucle recupera hasta 10 s. La sesión en curso se guarda cada 30 s y al ocultar la app; si se cierra, al reabrir se ofrece recuperarla. **Mantén la app en primer plano.** |
| **Codificador .FIT** | `@garmin/fitsdk` está pensado para Node o bundlers: obliga a usar un paso de compilación y aumenta el peso de la app. | Encoder FIT propio en `js/fit.js` (unas 200 líneas, sin dependencias, funciona sin conexión). **Validado con el decodificador oficial de Garmin (garmin-fit-sdk 21.222)**: CRC e integridad correctos, `sport=cycling`, `sub_sport=indoor_cycling` y todos los campos reconocidos. |
| **Importar a Garmin Connect** | La **app móvil** de Garmin Connect no permite importar archivos. | Descarga el .FIT y súbelo en **connect.garmin.com → ⬆ Importar datos** desde Chrome (también funciona en el teléfono con "Sitio de escritorio"). Si Android permite compartir el archivo, aparece además un botón **Compartir .FIT** (para enviarlo a Drive, correo, etc.). |
| **Sonido y vibración** | Chrome exige un toque antes de reproducir audio. | El audio se activa al tocar Iniciar, Conectar o Demo. |
| **HTTPS** | Web Bluetooth solo funciona en HTTPS (o `localhost`). | GitHub Pages y Netlify dan HTTPS gratis (ver sección 4). |
| **Precisión** | La potencia virtual depende de la presión de la llanta, la presión del rodillo contra la llanta y la temperatura del fluido. | Aviso de calentamiento al iniciar y factor de calibración (±20 %) en Ajustes. Espera algo como ±5–10 % frente a un medidor real si el montaje es consistente. |

---

## 2. Estructura de carpetas

```
potencia-virtual/
├── index.html            Interfaz (todas las pantallas)
├── manifest.json         Manifiesto PWA (ícono, nombre, modo standalone)
├── sw.js                 Service worker (funciona sin conexión)
├── README.md             Este documento
├── PRUEBAS.md            Lista de verificación
├── css/
│   └── styles.css        Estilos mobile-first, tema oscuro
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
└── js/
    ├── app.js            Lógica de la interfaz: une todos los módulos
    ├── ble.js            Web Bluetooth: conexión CSC, batería y reconexión
    ├── csc.js            Decodificación 0x2A5B/0x2A5C y cálculo de velocidad/cadencia
    ├── power.js          Curva del Fluid 2, calibración y promedios
    ├── zones.js          Zonas de Zwift (6) y Coggan (7)
    ├── metrics.js        Promedio, máx., NP, IF, TSS, kJ y tiempo por zona
    ├── session.js        Grabador por segundo, pausa/autopausa y test de FTP
    ├── workouts.js       Modelo por bloques, biblioteca y protocolo del test de FTP
    ├── chart.js          Gráficos en canvas (en vivo, perfil e historial)
    ├── db.js             IndexedDB (ajustes, entrenamientos, sesiones, FTP)
    ├── fit.js            Encoder .FIT con CRC
    ├── tcx.js            Exportación .TCX con <ns3:Watts>
    ├── simulator.js      Modo Demo (genera paquetes CSC binarios ficticios)
    └── feedback.js       Sonido, vibración y Wake Lock
```

### Fórmulas usadas
- **Velocidad** = Δrevoluciones de rueda × circunferencia / Δtiempo (tiempo en 1/1024 s). Se pasa a 0 si no llegan revoluciones nuevas en 3 s.
- **Cadencia** = Δrevoluciones de biela / Δtiempo × 60.
- **Desbordamiento**: `(actual − anterior + 2^n) mod 2^n` (n = 32 para las revoluciones de rueda y 16 para las de biela y los tiempos).
- **Potencia** = (a·v + b·v³) × (1 + calibración/100), v en mph, limitada entre 0 y 1500 W. Fluid 2: a = 8.9064, b = 0.0098.
- **NP** = raíz cuarta del promedio de (promedio móvil de 30 s)⁴. **IF** = NP/FTP. **TSS** = s × NP × IF / (FTP × 3600) × 100.

---

## 3. Probar en la computadora (opcional)

```bash
cd potencia-virtual
python3 -m http.server 8000
# Abre http://localhost:8000 en Chrome y usa el botón "Demo"
```
`localhost` cuenta como origen seguro, así que Web Bluetooth también funciona en Chrome de escritorio si la PC tiene Bluetooth.

---

## 4. Publicar gratis con HTTPS en GitHub Pages

1. Crea una cuenta en **github.com** (si no tienes).
2. Toca **New repository** → nombre, por ejemplo `potencia-virtual` → **Public** → **Create repository**.
3. En el repositorio: **Add file → Upload files**. Arrastra **el contenido** de la carpeta `potencia-virtual` (que `index.html` quede en la raíz, junto con las carpetas `css`, `js` e `icons`). Pulsa **Commit changes**.
4. Ve a **Settings → Pages**. En *Build and deployment* elige **Source: Deploy from a branch**, **Branch: main** y la carpeta **/ (root)**. Guarda.
5. Espera 1 o 2 minutos. La app quedará en
   `https://TU-USUARIO.github.io/potencia-virtual/` (con HTTPS automático).

> **Al actualizar la app**: sube los archivos modificados y cambia `CACHE_VERSION` en `sw.js` (por ejemplo `potencia-v1.0.1`). Así el teléfono descarga la versión nueva. Cierra y vuelve a abrir la app dos veces para que se aplique.

**Alternativa: Netlify Drop.** Entra en **app.netlify.com/drop** y arrastra la carpeta `potencia-virtual`. Te da una URL `https://…netlify.app` con HTTPS al instante.

---

## 5. Instalar en el Samsung Galaxy A55

1. Abre **Chrome** (no Samsung Internet) y entra en la URL de GitHub Pages.
2. Toca el menú **⋮** → **Agregar a pantalla de inicio** (o **Instalar app**) → **Instalar**.
3. Abre la app desde el ícono nuevo (se abre a pantalla completa y funciona sin conexión).
4. **Permisos**: la primera vez que toques **Conectar**, Android pedirá **Dispositivos cercanos** (Bluetooth): acéptalo. Verifica que el Bluetooth esté activado (y, en algunas versiones de Android, también la Ubicación).
5. **Batería**: en *Ajustes de Android → Aplicaciones → Chrome → Batería*, elige **Sin restricciones** para evitar que Android corte la conexión durante sesiones largas.
6. Monta el **Suunto Bike Sensor en el buje de la rueda trasera**, gira la rueda para despertarlo y toca **Conectar** → elige el sensor en la lista.

### Uso rápido
1. **Ajustes**: introduce tu FTP, peso y circunferencia (2096 mm para 700×23c).
2. **Entrenar**: elige *Entrenamiento: Libre* o uno de la biblioteca → **Iniciar** → calienta 10 min.
3. **Terminar** → revisa el resumen → **Guardar** → **Descargar .FIT** → súbelo a Garmin Connect.

---

## 6. Formato JSON de entrenamientos (importar/exportar)

```json
{
  "name": "Sweet Spot 3×10 min",
  "description": "3 bloques de 10 min al 90 %",
  "blocks": [
    { "type": "warmup",    "dur": 600, "from": 50, "to": 75 },
    { "type": "intervals", "reps": 3, "on": 600, "onPct": 90, "off": 300, "offPct": 55 },
    { "type": "steady",    "dur": 300, "pct": 60, "label": "Suave", "text": "Instrucción en pantalla" },
    { "type": "free",      "dur": 300 },
    { "type": "cooldown",  "dur": 600, "from": 65, "to": 45 }
  ]
}
```
Duraciones en segundos y objetivos en % del FTP. Puedes importar un objeto o un arreglo de objetos.
