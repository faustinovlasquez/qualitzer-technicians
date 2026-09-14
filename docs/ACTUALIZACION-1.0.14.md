# Qualitzer técnicos 1.0.14 · publicada

**APK publicada y verificada el 14-09-2026 a las 19:37:24.898 UTC**, código Android **15**. La [verificación de release](../artifacts/release-verification-1.0.14.json) y la [auditoría final de las 19:37:25.631 UTC](../artifacts/final-audit-1.0.14.json) identifican el mismo archivo.

## APK e instalación

| Dato | Valor verificado |
| --- | --- |
| APK | [artifacts/qualitzer-tecnicos-1.0.14-android.apk](../artifacts/qualitzer-tecnicos-1.0.14-android.apk) |
| Tamaño | **69,703,631 bytes** |
| SHA-256 | **e1ff7482d8e8b35f9d4159b55aa8810feb8328c938d568af0fbded74dc55a24c** |
| Paquete | com.qualitzer.field, sin cambio |
| Certificado SHA-256 | 06da359352b67f02805c065a4f7054fc863cc606221dfe054462f261da32b510, mismo que 1.0.13 |
| API | https://api-demos-qz-v2.qualitzer.com/mobile, sin cambio |
| Android | minSdk 24, targetSdk 36; arm64-v8a, armeabi-v7a y x86_64 |
| Permisos añadidos frente a 1.0.13 | **Ninguno**, comprobado en el APK |
| Procedencia | **104/104 fuentes críticas** con hash embebido coincidente; **1.175 entradas** del mapa, no 1.175 fuentes críticas |

Release no depurable, Hermes embebido y alineación 16 KiB verificados. La APK anterior 1.0.13 permanece intacta. Elegir **Actualizar**, sin desinstalar, cerrar sesión ni borrar datos, borradores o pendientes. El arranque del nuevo servicio de descarga se realizará después de este cierre documental; **no se acredita aquí una URL/IP de descarga activa**.

## Cambios incluidos

- Selector horario oficial `@react-native-community/datetimepicker` **9.1.0**, de 24 horas, sin teclear: inicio/fin de creación, inicio/término reales de entrega de trabajo y Desde/Hasta del horario silencioso de avisos. La edición continúa sujeta a permisos; los campos automáticos no pasan a ser manuales.
- Duración de mantenimiento con horas 0–99 y minutos 0–59; día de término 0–30. Elegir una hora menor no añade un día automáticamente. Cancelar conserva el valor anterior, incluso si era inválido.
- Sincronización parcial automática: los tipos conocidos no soportados esperan al servicio sin detener operaciones independientes compatibles. Sus dependientes esperan en orden. El intento manual distingue lo aplicado, lo pendiente, la espera de servicio y la revisión, sin presentar un resultado parcial como éxito total.

La sincronización requiere conexión, sesión válida y app en primer plano y desbloqueada; no funciona como servicio con la app cerrada. Persistencia local no equivale a aplicación remota; un recibo aplicado exige reconciliar la lectura del trabajo y día correspondientes. Se conservan UUID, payload, archivos y bloqueos de entrega por permisos, fechas, evidencias o pendientes.

## Evidencia y límites

- [Validación completa, 18:59:55–19:01:57 UTC](../artifacts/logs/time-sync/2026-09-14T18-59-55-831Z/report.json): **1.663 pruebas únicas aprobadas, 1 omitida, 0 fallos**; tipos de app, cliente ampliado y servidor Mobile sin diagnósticos. Las 225 focalizadas ya están incluidas.
- [UI RN Web, 19:14:37–19:16:00 UTC](../artifacts/logs/time-sync-ui/SUMMARY.md): **48/48 casos, 1.753 aserciones, 72 PNG**, tipos y navegador sin errores; seis campos horarios ejercitados con puertos simulados. No son pruebas nativas.
- [Nativo Android API 36](../artifacts/logs/native-release-1.0.14/SUMMARY.md): APK exacta instalada en emulador propio 5580, PID **5831**, arranque sin fatal observado. En creación no productiva se confirmó fin **13:01** mediante spinner y se conservó al reabrir y cancelar.
- No se probaron nativamente los seis campos, iOS, teléfono físico/Samsung, biometría ni el selector dentro de `PrivateModal` de entrega. Demo tenía `allowEditExecutionTime: false`; no se modificó ese permiso. Firebase inicializado no demuestra entrega push.
- No hubo mutaciones de negocio reales. Sí se persistió **13:01** en el borrador propio de Demo, dejado sin enviar; inicio vacío. Los dos registros históricos `needs_review` y la foto virtual previa se conservaron sin inspeccionar su contenido.

## Gateway: auditoría cerrada y acción del operador

La [auditoría de las 19:07 UTC](../artifacts/logs/time-sync-audit/SUMMARY.md) confirmó **351/351 fuentes y 91/91 manifiestos de dependencias idénticos**, además de 225/225 fuentes actuales y 21/21 entradas adicionales coincidentes con la validación. **No hace falta generar otro gateway**: se conserva **1.0.4**, 585030 bytes, SHA-256 **b908c95b785b4d4d402f74ad7facb80ed20806dc166a59026b3ec40e2a2319ae**. Quien ya lo ejecuta con backend compatible no necesita reinstalarlo por 1.0.14.

Hallazgo **local**, no remoto: referencias/lock declaran **1.0.4**, pero la dependencia instalada es **1.0.0**. Las fuentes TS y el compilado local contienen marcadores timer/checklist; eso no prueba qué ejecuta el servidor del usuario.

1. El operador debe ejecutar el [diagnóstico de disco](../../Qualitzer2.0-Backend/scripts/check-mobile-sync-deployment.cjs) **en la raíz física del backend remoto que atiende al usuario**, siguiendo la [guía de diagnóstico y corrección](../../Qualitzer2.0-Backend/docs/diagnostics/mobile-sync-deployment.md). Confirmar proceso, cwd, modo TS/compilado, proxy y upstream sin compartir secretos.
2. Si está desactualizado, instalar realmente el **gateway aprobado 1.0.4 y backend compatible**, no sólo cambiar referencias. Preparar la instalación autorizada sin modificar dependencias de un proceso vivo; actualizar el compilado si ese proceso lo usa.
3. Activar el release correcto deteniendo y drenando el escritor anterior antes de iniciar **uno solo**, fork/una instancia, sin rolling reload superpuesto. Conservar claves, sesiones y almacenamiento; repetir el diagnóstico y verificar el proceso activo.
4. Mantener la app conectada, abierta y desbloqueada para el reintento automático. **La app no puede aplicar tipos no soportados hasta desplegar el servicio compatible**, ni garantizar que los siete pendientes terminen aplicados: conflictos y revisión requieren evaluación, nunca vaciar la cola o reenviar por rutas legacy.

Esta actualización no añade runtime backend, protocolo de red ni SQL/migraciones. El diagnóstico backend nuevo y su guía son herramientas de inspección, no un despliegue. El remoto sigue sin verificar. [Registro de entrega](../artifacts/logs/time-sync/DELIVERY.md).