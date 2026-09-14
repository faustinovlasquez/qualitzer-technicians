# Qualitzer técnicos 1.0.12 / código 13 — actualización disponible

## Estado — 14 de septiembre de 2026

**APK 1.0.12 compilada, firmada y publicada localmente a las 16:19:29 UTC.** El [registro de compilación de 15:55:19](../artifacts/logs/2026-09-14T15-55-19-791Z/phases.json) acredita prebuild y assemble con código 0. La [verificación final](../artifacts/release-verification-1.0.12.json) y la [auditoría](../artifacts/final-audit-1.0.12.json) comprueban identidad, firma, alineación, iconos, 81 fuentes críticas embebidas y ausencia de permisos añadidos. La APK anterior permanece intacta.

- [APK Android 1.0.12](../artifacts/qualitzer-tecnicos-1.0.12-android.apk): **69.164.275 bytes**.
- SHA-256: **fdb67eafb6f99a5e71d29f3e90ab01fb26af093c3597044437ccc298672de941**.
- Android 7 o posterior; ARM64, ARMv7 y x86_64; mismo paquete, certificado y API de la versión anterior.
- [Arranque Android](../artifacts/logs/native-release-1.0.12/push-client-startup.json): actualización sin borrar datos en el emulador propio API 36, APK instalada idéntica, Firebase inicializado y sin fallo fatal detectado. La navegación demo mostró Trabajo sin los avisos grandes. El [smoke de cámara](../artifacts/logs/native-release-1.0.12/SMOKE-CAMERA-SUMMARY.md) quedó incompleto antes de llegar a la cámara: **no acredita captura ni retorno con biometría en Android**. La comprobación de ese flujo se realizó con los puertos del sistema simulados descritos abajo.

Esta actualización se limita a la presentación de mensajes y al regreso de los selectores nativos. **No incluye una versión nueva del backend o del gateway ni una migración nueva.** No acredita que el servidor ya esté actualizado o funcionando para los envíos pendientes.

## Qué cambia para el técnico

- Se retiran avisos repetitivos de conexión y explicaciones técnicas de las pantallas de trabajo. Los códigos internos se presentan como mensajes breves; siguen visibles los pendientes y los problemas que requieren atención.
- Si el servicio necesario no está disponible, se muestra **«Sincronización no disponible. Contacta a soporte.»**. Este mensaje no significa que los cambios se hayan enviado.
- Al abrir cámara, galería o archivos desde la app ya desbloqueada, una selección válida permite volver sin repetir huella/PIN. No hace falta desactivar la seguridad del teléfono.
- Seleccionar una foto no equivale a guardarla ni enviarla. Revisa la selección, pulsa **Guardar archivos** y espera la confirmación de guardado local. El envío y la actualización de la ficha siguen siendo pasos distintos.

## Cámara y seguridad: excepción limitada

La autorización temporal existe **solo en memoria**, vinculada a una única operación nativa iniciada desde la app desbloqueada. No se guarda un permiso de desbloqueo en disco, no se comparte entre selectores y no se restaura al reiniciar.

Para continuar deben cumplirse las tres condiciones: terminar la promesa del selector nativo, volver a primer plano y confirmar que la protección visual de la transición actual está lista. Volver a primer plano por sí solo no autoriza el acceso. Mientras se espera, la interfaz privada y sus acciones permanecen protegidas.

La espera del selector muestra una cubierta neutral con «Esperando selección», sin botones de huella/desbloqueo; no representa un nuevo permiso de acceso. Cuatro pruebas del provider y pantalla de bloqueo reales cubren ambos órdenes de retorno con éxito y cancelación, conservan los modales privados ocultos y verifican que una salida normal a Home vuelve a pedir autenticación. Su sistema operativo está simulado; no acreditan una cámara física.

- El límite total es de **5 minutos desde el inicio de la operación**, incluyendo la espera de regreso y privacidad. No es un período general de gracia para usar otras aplicaciones.
- Una cancelación normal del selector vuelve sin añadir archivos, siempre que la autorización temporal siga siendo válida. Un error, vencimiento o invalidación no permite usar un resultado tardío para desbloquear.
- Si vence el plazo o Android destruye la actividad/proceso y se pierde la operación, se mantiene el bloqueo cuando la seguridad está activada. Desbloquea y vuelve a seleccionar o tomar la foto; no se garantiza recuperar una selección aún no guardada.
- El arranque en frío, la salida normal a otra aplicación y el bloqueo habitual del teléfono conservan la protección anterior. No se elimina la huella/PIN ni se concede una sesión remota mediante la cámara.

La validación realizada **no demuestra el comportamiento de cámara, sensores biométricos o PIN en un teléfono físico**. Android y cada aplicación de cámara pueden gestionar el ciclo de vida de forma distinta. Consulta [Seguridad del teléfono](SEGURIDAD-TELEFONO.md).

## Requisito de servidor que sigue vigente

En la versión 1.0.11 se ha mostrado el código `MOBILE_SYNC_ACTIONS_UNAVAILABLE` en las pantallas del usuario. Ocultarlo o traducirlo a un mensaje comprensible **no corrige su causa en el servidor**.

El envío de inicio, pausa, reanudación y asociación de checklist pendientes sigue requiriendo **el backend compatible con timer/checklist y el gateway 1.0.4 existentes**. No se cambia el protocolo, los UUID, recibos, permisos, cola o reglas del cronómetro. El tiempo oficial sigue siendo el que confirma el servidor al aplicar; no se reconstruye tiempo offline ni se cuentan pendientes como avance confirmado.

Soporte debe seguir el [procedimiento de despliegue de fluidez existente](../../Qualitzer2.0-Backend/docs/ACTUALIZACION-FLUIDEZ-MOVIL.md): comprobar la versión realmente instalada, completar el despliegue compatible si falta, conservar claves y datos, detener y esperar el drenaje antes de arrancar un solo escritor, y comprobar el flujo con un piloto autorizado. Una respuesta de salud correcta no prueba que estos comandos estén disponibles. Las migraciones históricas que falten siguen sujetas al procedimiento autorizado; **1.0.12 no añade ninguna**.

## Artefactos anteriores que se conservan

| Referencia existente | SHA-256 requerido |
| --- | --- |
| [APK 1.0.11 / código 12](../artifacts/qualitzer-tecnicos-1.0.11-android.apk) | 287dc01e099766f2edf8d6ce065bb906f33079eb33e968d05542cbda5b4abf60 |
| [Gateway 1.0.4](../artifacts/mobile-gateway/qualitzer-mobile-gateway-1.0.4.tgz) | b908c95b785b4d4d402f74ad7facb80ed20806dc166a59026b3ec40e2a2319ae |

El gateway y su [informe de validación existente](../artifacts/logs/fluidity-package/2026-09-14T13-18-05-719Z-q78U13/report.json) no se modifican ni se regeneran. El [cierre de solo lectura de 16:08:21](../artifacts/logs/picker-messages-delivery/2026-09-14T16-08-21-185Z-sFWAeM/report.json) vuelve a medir el TGZ: 585030 bytes y el SHA-256 indicado. Sus 351 fuentes y 91 manifiestos de dependencias coinciden exactamente con el manifiesto embebido: no hace falta un nuevo paquete por estos cambios. La copia TGZ del Backend es idéntica; los sidecars solo difieren por CRLF y sus diferencias binarias quedan registradas. Las referencias de dependencia y lock coinciden, sin comprobar instalación o despliegue. No instalar ni sobrescribir el gateway 1.0.3, generado antes de la corrección semanal.

La página de descarga conserva las comprobaciones de identidad, firma, versión, tamaño y hash de la APK, así como el informe obligatorio del gateway con sus seis comprobaciones, versión, ruta, tamaño y hash coincidentes. Además exige el hash inmutable indicado de 1.0.4. El informe final de 1.0.12 habilita sus propios bytes; no reutiliza los de 1.0.11.

## Instalación y comprobación en el teléfono

1. Descargar la APK publicada y elegir **Actualizar** sobre la app instalada. **No desinstalar ni borrar datos, caché o pendientes.** No se requiere un nuevo gateway por esta versión.
2. Abrir y desbloquear la app; tomar una foto desde el trabajo y aceptar o cancelar la captura. Comprobar que vuelve al mismo borrador sin una segunda huella. Guardar los archivos para incorporarlos a la cola.
3. Salir normalmente de la app y volver: la protección habitual debe seguir activa. La prueba física de cámara, biometría, vencimiento del plazo y destrucción de actividad sigue pendiente.
4. Confirmar con soporte el requisito anterior de backend compatible + gateway 1.0.4. No dar por resuelto el servidor porque desapareció un mensaje técnico.
5. Mantener la app abierta y desbloqueada con conexión para sincronizar. Si el envío sigue sin estar disponible, contactar a soporte sin repetir envíos ni forzar cambios de UUID.

## Evidencia de pruebas y recuento corregido

- [Validación existente de 15:46:30](../artifacts/logs/picker-messages/2026-09-14T15-46-30-235Z/report.json): 1386 PASS oficiales y 1 omitido; 89 PASS suplementarios, de los cuales 8 se repiten por importación del wrapper TS al TSX. **1467 PASS únicos, 1 omitido, 0 fallos**, no 1475 únicos.
- El foco contiene **228 ejecuciones PASS, 220 pruebas únicas**, ya incluidas en el total. Las cuatro pruebas de cubierta neutral están incluidas; no se suman otra vez.
- [UI existente de 15:52:21](../artifacts/logs/picker-messages-ui/2026-09-14T15-52-21-525Z/report.json): 30 casos PASS, 1361 aserciones y 92 capturas; sin errores de tipos/página/runner ni cambios de fuentes durante la ejecución. No es evidencia de dispositivo físico.
- [Resumen y explicación del doble conteo](../artifacts/logs/picker-messages/SUMMARY.md). Los JSON y logs históricos permanecen intactos. El [auditor de entrega](../scripts/testing/picker-messages-delivery.cjs) solo compara evidencia y hashes; su `nativePending: true` corresponde al corte anterior a instalación y publicación, no a una comprobación de cámara realizada después.
- Cierre de fuentes: **165/165 runtime, 62/62 UI y 81/81 de la captura de compilación** coinciden con las referencias. Perfil incluido, sin excepciones. La verificación final de APK posterior acredita las 81 fuentes críticas embebidas. Después de publicar no se modifican fuentes de ejecución.