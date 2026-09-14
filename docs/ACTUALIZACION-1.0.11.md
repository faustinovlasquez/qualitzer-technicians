# Qualitzer técnicos 1.0.11 / código 12 — guía de actualización

## Publicación confirmada — 14 de septiembre de 2026, 13:32 UTC

**APK compilada, firmada y publicada en los artefactos locales.** La verificación final es del **2026-09-14T13:32:29.433Z**. No equivale a despliegue del servidor ni a descarga HTTP ya habilitada.

**Antes de instalar: el usuario/operador debe instalar y desplegar Backend compatible con `timer`/`checklist` y gateway 1.0.4. El despliegue en producción sigue pendiente.** La dependencia y el lockfile Backend ya apuntan a 1.0.4, pero esta preparación no instaló la actualización en su `node_modules` ni verificó la versión instalada. Un `/health` correcto no acredita los comandos nuevos.

| Artefacto publicado | Tamaño | SHA-256 |
| --- | --- | --- |
| [APK 1.0.11](../artifacts/qualitzer-tecnicos-1.0.11-android.apk) | 69.155.859 bytes | 287dc01e099766f2edf8d6ce065bb906f33079eb33e968d05542cbda5b4abf60 |
| [Gateway 1.0.4](../artifacts/mobile-gateway/qualitzer-mobile-gateway-1.0.4.tgz) | 585.030 bytes | b908c95b785b4d4d402f74ad7facb80ed20806dc166a59026b3ec40e2a2319ae |

La [verificación de APK](../artifacts/release-verification-1.0.11.json) confirma paquete `com.qualitzer.field`, versión 1.0.11/código 12, release no depurable, Hermes y standalone sin actualizaciones remotas, ARM64/ARMv7/x86_64 y alineación de 16 KiB. Certificado SHA-256 sin cambios: **06da359352b67f02805c065a4f7054fc863cc606221dfe054462f261da32b510**. API/pasarela conservada: `https://api-demos-qz-v2.qualitzer.com/mobile` (no es la página de descarga).

La [auditoría de APK, 13:32:29.945Z](../artifacts/final-audit-1.0.11.json) confirma **ningún permiso añadido**, misma firma, iconos verificados y APK 1.0.10 intacta. La procedencia registra **78 fuentes críticas coincidentes** con el bundle, incluida la corrección semanal; las 1144 fuentes del sourcemap no son 1144 fuentes críticas auditadas.

## Cómo actualizar sin perder pendientes

1. El operador instala y despliega **Backend compatible + gateway 1.0.4 antes de instalar la app**. Conserva HTTPS, directorio privado, claves, sesiones, colas y recibos; detiene, espera el drenaje/salida y arranca un solo escritor, sin reinicios superpuestos. Confirma funcionamiento mediante un piloto autorizado.
2. Revisa las migraciones históricas de creación, recibos y notificaciones, incluida gestión de bandeja cuando corresponda. **No hay migración nueva por timer/checklist** (`kind` ya usa `STRING(20)`); el esquema remoto no se ha verificado. No ejecutar un migrador global por esta ampliación.
3. Cuando se habilite y compruebe la **página de descarga vigente**, descarga la APK 1.0.11 y elige **Actualizar** sobre Qualitzer técnicos. La página se iniciará después de este cierre documental: aquí no se anuncia IP, URL, QR ni descarga comprobada. Hasta confirmar servidores compatibles, conserva la app instalada.
4. **No desinstales ni borres datos, caché o pendientes.** Abre y desbloquea la app; mantén conexión y sesión válida para que continúen los envíos. Los elementos «por revisar» requieren revisión, no borrado ni reintento forzado.

El [paquete de las 13:18 UTC](../artifacts/logs/fluidity-package/2026-09-14T13-18-05-719Z-q78U13/report.json) acredita dos builds/packs idénticos, 351 fuentes y 91 dependencias, carga CommonJS aislada Node 20.12.2 sin invocar la fábrica y copia Backend idéntica. La [auditoría de fuentes de las 13:23 UTC](../artifacts/logs/fluidity-final-audit/2026-09-14T13-23-43-233Z-ovDXbr/report.json) coteja además checksum, manifiesto y referencia/integrity del lockfile Backend con ese TGZ. **Gateway 1.0.3 se conserva como generado, no entregado: no instalarlo ni sobrescribirlo**, pues contiene la reconciliación semanal anterior. El manual incorporado y las entradas del paquete permanecen congelados.

## Qué cambia al trabajar

- Creaciones, respuestas, comentarios y archivos se guardan de forma durable antes de enviarse. Espera la confirmación de guardado local; un borrador sin guardar todavía no está en la cola. La creación abre automáticamente el trabajo local o la agenda sin un segundo envío.
- Inicio, pausa y reanudación, y asociación de una plantilla existente, pueden quedar pendientes si hay identidad, sucursal, fecha, permisos y datos locales válidos. No todas las acciones están disponibles offline.
- **Guardado local, envío aplicado y ficha actualizada son estados distintos.** Lo pendiente no suma avance confirmado ni habilita entrega. Reporte, borrado de archivos, finalización/entrega, edición manual del tiempo e inicio de OT siguen online.
- Se conservan las mejoras anteriores de agenda, reanudación, avisos y protección local, con capturas permitidas estando desbloqueada.

### Sincronización y cronómetro

«En segundo plano» significa **respecto de la interfaz**, con la app abierta, en primer plano y desbloqueada, conexión y autorización válidas. No se promete ejecución continua con la app suspendida, terminada o bloqueada; lo ya persistido se retoma al recuperar esas condiciones.

El servidor fija el tiempo oficial **al aplicar el comando, no al tocar el teléfono**. No reconstruye tiempo offline: inicio y pausa aplicados juntos pueden sumar cero segundos.

Un recibo `applied` no garantiza una ficha fresca. Si aparece **«Envío confirmado · esperando actualizar estado y tiempo»**, no repitas la acción: espera la lectura posterior o actualiza la ficha si falla. No se extrapola tiempo pendiente como oficial. La vista semanal conserva juntos el trabajo y la prueba causal de cada fecha exacta; no usa el timer ni la confirmación de otro día. Una lectura autoritativa posterior prevalece.

## Evidencia y límites

- Mobile completo: **1308 aprobadas, 1 omitida por plataforma, 0 fallos**. UI React Native Web: **18/18 escenarios, 463 aserciones, 44 capturas y 0 errores de tipos**.
- Auditoría ampliada de fuentes: **10 checks aprobados**, tipos app/app+pruebas/servidor Mobile **0/0/0 diagnósticos** y **33/33** pruebas focalizadas de creación automática/tarjetas. No sumar estas ni las 556 focalizadas al total completo.
- [Arranque nativo](../artifacts/logs/native-release-1.0.11/push-client-startup.json): APK realmente instalada con hash coincidente, emulador propio API 36, PID 3951. [Prueba DEMO acotada](../artifacts/logs/native-release-1.0.11/SUMMARY.md): una pulsación efectiva de pausa, 3→2 pendientes y actualización automática a **«En pausa» a las 13:30:25.657Z**, sin refrescar/reintentar y conservando los dos antiguos por revisar. PID estable en la ventana observada.
- No hubo cuenta real ni operaciones de negocio en servidor para estas pruebas; no se acredita MySQL, teléfono físico, biometría física, push remoto ni sincronización continua con la app cerrada. El chequeo público de salud no sustituye el despliegue compatible. La prueba nativa no inspeccionó recibos internos ni SQLite.

Informes y límites combinados: [resumen de evidencia](../artifacts/logs/durable-fluidity/SUMMARY.md). Este cierre solo actualiza documentación; no repite validaciones ni inicia la descarga.

## Referencias y recuperación

- [Guía de fluidez](ACTUALIZACION-FLUIDEZ-MOVIL.md), [contrato y despliegue Backend](../../Qualitzer2.0-Backend/docs/ACTUALIZACION-FLUIDEZ-MOVIL.md), [instalación del gateway embebido](EMBEDDED-GATEWAY.md) y [requisitos históricos de notificaciones](../../Qualitzer2.0-Backend/docs/ACTUALIZACION-NOTIFICACIONES-MOVILES.md).
- Ante rollback, detener los productores nuevos y conservar cola/recibos. No convertir operaciones al protocolo legacy, alterar UUID o borrar pendientes para forzar replay. Conservar la APK anterior no autoriza un downgrade destructivo.