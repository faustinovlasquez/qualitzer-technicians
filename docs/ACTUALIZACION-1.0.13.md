# Actualización 1.0.13 — APK publicada

**Estado: publicada por el flujo principal el 14 de septiembre de 2026. Versión 1.0.13, código Android 14.** APK firmada, verificada e instalada sobre la anterior en el emulador; no se ha probado en un teléfono físico. El inicio del servicio de descarga es posterior a este cierre documental.

## Artefacto verificado

- APK: [artifacts/qualitzer-tecnicos-1.0.13-android.apk](../artifacts/qualitzer-tecnicos-1.0.13-android.apk).
- Tamaño exacto: **69.180.083 bytes**.
- SHA-256: `a2c2d1f52394499230f12b4ed2f3a195d71d48a43a007cb1a06e8fec570ec3cf`.
- Verificación: **2026-09-14T17:57:10.856Z**; auditoría final: **2026-09-14T17:57:11.410Z**.
- Paquete `com.qualitzer.field`, misma firma que 1.0.12, sin permisos añadidos; APK anterior intacta. **Actualizar sin desinstalar ni borrar datos, archivos o colas.**
- **93 fuentes críticas coincidentes** con el contenido embebido; el mapa contiene 1.150 fuentes en total. Release no depurable, Hermes embebido y actualizaciones remotas deshabilitadas.
- Compilación `assemble-release`: **111 segundos**. Sin ediciones de runtime posteriores; esta actualización solo cambia documentación externa al APK.

Fuentes: [verificación](../artifacts/release-verification-1.0.13.json), [auditoría final](../artifacts/final-audit-1.0.13.json) y [fases de compilación](../artifacts/logs/2026-09-14T17-36-01-474Z/phases.json). La auditoría de republicación registra `compileSeconds: null`; los 111 segundos corresponden a la compilación original, no a otra compilación.

## Cámara y revisión de entrega

La cámara consulta el permiso y solo lo solicita cuando corresponde. La guía ofrece reintento, Galería o Cancelar; ante denegación permanente permite abrir Ajustes. Volver de Ajustes mantiene el desbloqueo habitual y exige reintentar: no concede permisos ni abre la cámara automáticamente.

Se mantiene la protección visual antes de abrir el selector, la cubierta neutra durante la operación y el límite total de cinco minutos sin renovación. Retomar requiere resultado nativo, primer plano y privacidad vigente. No se promete recuperar fotos sin guardar tras la muerte del proceso.

**Entregar trabajo abre la revisión, no entrega automáticamente.** Muestra los requisitos pendientes y mantiene bloqueada la confirmación mientras falten sincronización, conexión, verificación de ficha, checklist, respuestas o evidencias, según corresponda. No se añade entrega offline ni se omiten validaciones del repositorio o servidor.

## Validación y límites

- Suite completa del **14/09, 17:29:47–17:31:20 UTC**: **1.488 oficiales + 81 suplementarias = 1.569 pruebas únicas aprobadas, 1 omitida, 0 fallos**. Las 296 enfocadas se solapan y no se suman; cero diagnósticos de tipos.
- UI del **14/09, 17:41:42.895 UTC**: **48/48 casos, 2.025 aserciones y 100 PNG**. Prueba aislada con puertos del sistema simulados, no entrega real al backend.
- Android API 36, emulador en demostración: **permiso real → apertura de cámara nativa → disparo → aceptación → una imagen/borrador sin guardar**, sin error observado en las muestras del proceso. No se pulsó Guardar ni se subió la foto; no acredita persistencia tras reiniciar. La revisión abrió con checklist pendiente y se cerró sin confirmar.
- **No se enroló ni probó biometría física**; el estado biométrico habilitado no quedó acreditado. Seguridad cubierta por pruebas con provider/controlador reales y puertos nativos simulados, no por autenticación biométrica nativa demostrada.

Informes y capturas: [cierre de entrega](../artifacts/logs/camera-delivery/DELIVERY.md) y [recorrido nativo](../artifacts/logs/native-release-1.0.13/SUMMARY.md).

## Requisito de despliegue que sigue pendiente

Los **5 pendientes de la captura del usuario** y `MOBILE_SYNC_ACTIONS_UNAVAILABLE` **no quedan resueltos por esta APK ni por mostrar mejor la revisión**. Sigue siendo necesario desplegar el backend compatible con timer/checklist y el gateway **1.0.4**. El health HTTP 200 solo acredita conectividad, no disponibilidad de esas acciones ni sincronización de la cola. No borrar pendientes para ocultar el problema.

No hay backend, gateway, protocolo ni migración nuevos por 1.0.13. El gateway 1.0.4 existente no se reempaqueta; las migraciones históricas que falten conservan el [procedimiento existente](ACTUALIZACION-FLUIDEZ-MOVIL.md). No se cambian credenciales, endpoints, identidad de firma ni colas. La entrega push remota tampoco queda certificada por la verificación del cliente.