# Login para usuarios

## Cambios

- El acceso conserva usuario, contraseña, mostrar/ocultar contraseña, envío por botón o teclado y sesión recordada automáticamente. No se añade una preferencia de persistencia que la autenticación no soporte.
- El login normal no muestra pasarela, URL, comprobación de conexión ni configuración avanzada. Los errores se presentan mediante mensajes controlados: credenciales, límite de intentos, conexión, empresa, guardado de sesión o incompatibilidad de versión. No se reproduce texto desconocido del servidor.
- Las herramientas técnicas solo se montan con `__DEV__ && !gatewayConfiguration.locked`. `locked` incluye standalone y release nativo según la configuración existente. En desarrollo permitido, la configuración y la comprobación quedan dentro de «Conexión avanzada», colapsada inicialmente.
- El QR de desarrollo y su espacio lateral usan la misma condición. No se cambia el estado legítimo de conexión dentro de la app.
- **«Explorar demostración» sigue disponible también en standalone**, sin exigir credenciales. Se mantiene su callback original y el aviso de datos de ejemplo; no se altera el modo demo.

## Límites

No se modificaron el hook de autenticación, selección de empresa, comprobaciones internas de salud, persistencia, colas ni configuración de seguridad. La URL de producción sigue fijada y los bloqueos por configuración inválida o sesión de otro servidor siguen vigentes. No se modifica el perfil ni la versión; no se genera ni publica APK.

## Regresión aislada

- [Pruebas estructurales](../tests/login-user-ui.test.ts): condición de montaje, callback de login, teclado, demo, aviso de sesión y QR.
- [Smoke de login](../tests/e2e/login-user-smoke.cjs): pantalla real sobre React Native Web, callbacks ficticios y red bloqueada. Release con/sin bloqueo, desarrollo standalone y desarrollo editable; anchuras 320, 390 y 1280; errores, validación, estado ocupado, limpieza de contraseña, envío y demo.
- [Validador específico](../tests/e2e/login-user-validation.cjs): diagnósticos TypeScript de los archivos propios, pruebas estructurales y regresiones existentes de conexión/standalone, más el smoke. Ejecutable con Node 22; guarda informes nuevos en el directorio temporal.

Validación final: **18 comprobaciones UI y 27 pruebas estructurales/conexión/standalone aprobadas; cero diagnósticos TypeScript en los tres archivos propios comprobados**. Informe temporal de esta ejecución: `qualitzer-login-validation-lPuCyZ`, del 11 de septiembre de 2026 a las 14:21 UTC. Iconos decorativos y gradiente sustituidos en la fixture; no prueba visual de esos detalles. Sin uso de cuentas reales, llamadas API, Metro ni servidores existentes. La verificación nativa corresponde al coordinador; estas pruebas no verifican el APK instalado ni un teclado físico.