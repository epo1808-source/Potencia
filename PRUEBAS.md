# Lista de pruebas

Marca cada punto al verificarlo. Las pruebas **A** se hacen sin bicicleta (modo Demo); las **B**, con el sensor y el rodillo.

## A. Sin sensor (modo Demo)
- [ ] A1. La app abre en Chrome desde la URL HTTPS y muestra "Conecta el sensor o prueba el modo Demo".
- [ ] A2. **Instalación**: "Agregar a pantalla de inicio" crea el ícono; la app abre a pantalla completa.
- [ ] A3. **Sin conexión**: activa el modo avión, abre la app desde el ícono y comprueba que carga.
- [ ] A4. Toca **Demo**: el indicador muestra "Simulador (Demo)" y batería 87 %. En 2 a 3 s aparecen velocidad, cadencia y potencia (el simulador arranca con contadores cerca del máximo para probar el **desbordamiento**: no debe haber saltos absurdos de velocidad).
- [ ] A5. Cambia el FTP en Ajustes y comprueba que la zona, el % y el color del encabezado cambian.
- [ ] A6. Cambia el promedio a 1 s, 3 s y 5 s: el número reacciona más o menos rápido y el rótulo cambia.
- [ ] A7. **Iniciar**: aparece el aviso de calentamiento. Al aceptar, el tiempo avanza y la pantalla no se apaga.
- [ ] A8. **Autopausa**: toca "Simular parada 10 s". La velocidad baja a 0 en unos 3 s, aparece "Autopausa" y el tiempo se detiene. Al volver a pedalear, el tiempo continúa.
- [ ] A9. **Pausar/Reanudar** manual.
- [ ] A10. Elige **Sweet Spot 3×10** antes de iniciar: se ven el objetivo en W, el tiempo restante, el siguiente bloque y el perfil con el marcador. El indicador de cumplimiento se pone verde, ámbar o rojo.
- [ ] A11. **Avisos de cambio de bloque**: 3 pitidos y vibraciones cortas a los 3, 2 y 1 s, y un tono largo al cambiar de bloque. Para probarlo rápido, crea un entrenamiento con bloques de 0:20.
- [ ] A12. **Terminar** → el resumen muestra el tiempo en cada zona → **Guardar** → se abre el detalle con el gráfico.
- [ ] A13. **Historial**: la sesión aparece en la lista con su resumen.
- [ ] A14. **Recuperación**: inicia una sesión, espera más de 40 s y cierra Chrome por completo. Al reabrir, la app ofrece guardar la sesión sin terminar.
- [ ] A15. **Entrenamientos**: crea uno nuevo, edítalo (cambiar tipo, mover ↑↓, borrar bloque), guárdalo, duplícalo, expórtalo a JSON, bórralo e impórtalo otra vez.
- [ ] A16. **Zonas**: cambia a 7 zonas de Coggan; edita un límite (por ejemplo, poner un valor menor que el anterior debe mostrar un error) y usa "Restaurar zonas".
- [ ] A17. **Test de FTP** (rápido): el protocolo completo dura ~66 min; para probar el cálculo en 1 min, importa un JSON con `"ftpTest": true` y un bloque `{"type":"free","dur":60,"test":true}`. Al terminar debe proponer FTP = 95 % del promedio y guardarlo en "Historial de FTP".

## B. Con el sensor Suunto y el rodillo
- [ ] B1. Sensor montado en el **buje trasero**. Gira la rueda para despertarlo y toca **Conectar**: aparece en la lista de Chrome (se filtra por el servicio 0x1816).
- [ ] B2. El indicador se pone verde con el nombre del sensor y, si lo expone, el % de batería.
- [ ] B3. Si aparece el aviso "modo CADENCIA", reubica el sensor en la rueda o cambia su modo.
- [ ] B4. **Velocidad**: pedalea constante y compara con la velocidad que muestra la app Suunto u otro ciclocomputador. Deben coincidir con un margen de ±0,5 km/h. Si no, revisa la circunferencia (prueba del rodado: marca la llanta, avanza una vuelta y mide en mm).
- [ ] B5. **Cadencia**: si el sensor solo envía velocidad, debe mostrarse `--` sin errores.
- [ ] B6. **Potencia**: verifica con la curva. A 30,0 km/h debe dar ≈ **230 W**; a 20 km/h ≈ **130 W**; a 40 km/h ≈ **372 W** (calibración 0 %). En Ajustes se muestra esta tabla.
- [ ] B7. **Parada**: deja de pedalear; en unos 3 s la velocidad y la potencia pasan a 0.
- [ ] B8. **Reconexión**: con la sesión iniciada, aleja el teléfono más de 10 m (o tapa el sensor) hasta que el indicador muestre "Reconectando…". Al volver, debe reconectarse solo y la sesión debe continuar.
- [ ] B9. **Sesión larga**: haz 60 min con la pantalla encendida y verifica que no haya cortes (Chrome con batería "Sin restricciones").

## C. Exportación a Garmin Connect
- [ ] C1. En el detalle de la sesión, **Descargar .FIT** guarda `rodillo_AAAA-MM-DD_HHMM.fit` en Descargas.
- [ ] C2. En connect.garmin.com → **Importar datos**, sube el .FIT. Debe aparecer como **Ciclismo en interiores** con la duración, distancia, potencia media/máx., NP, TSS, IF y gráfico de potencia y cadencia.
- [ ] C3. (Opcional) Valida el archivo en la PC con la herramienta oficial **FitCSVTool** del FIT SDK de Garmin: `java -jar FitCSVTool.jar rodillo_….fit` no debe reportar errores de CRC.
- [ ] C4. **Descargar .TCX** y subirlo también (como respaldo). Debe mostrar la potencia.
- [ ] C5. Una sesión con pausas: Garmin debe mostrar el tiempo en movimiento (sin pausas) y el tiempo transcurrido total.
