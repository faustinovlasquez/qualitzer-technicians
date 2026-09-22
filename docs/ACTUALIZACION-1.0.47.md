# Qualitzer tecnicos 1.0.47

APK codigo48, misma firma. Actualizar sin borrar datos, sesiones, colas, recibos ni borradores.

## Permisos y acciones

Al entrar con sesion desbloqueada se presenta el aviso de ubicacion por acciones y despues el permiso nativo durante el uso. Si el GPS esta apagado se ofrece la activacion del proveedor Android. Una denegacion se respeta: no hay bucle de ventanas ni captura sin consentimiento. Ajustes del telefono y Mi perfil permiten revisar permisos.

Se eliminan la captura periodica, el servicio continuo y el permiso de ubicacion de fondo. No se toma GPS por abrir o dejar abierta la app, ni en cada tick de sincronizacion. Los callbacks antiguos de fondo solo detienen servicios. La subida de puntos pendientes sigue en primer plano con conexion.

Se solicita una posicion al iniciar/reanudar/pausar/completar/entregar/reabrir trabajo, crear/editar/completar/reabrir/borrar actividad, guardar/asociar checklist, cambiar ubicacion del equipo, iniciar/entregar orden, subir/borrar archivos, comentar y guardar reporte. Se conserva el registro cuando el cambio es confirmado o guardado en cola; una accion fallida no se etiqueta como realizada. Cada evento conserva accion, grupo/trabajo, instante, precision, UUID y destino secundario cuando existe. La cola guarda operationId y estado QUEUED; ese estado describe el momento de la captura, no el estado posterior del comando.

No se recaptura al sincronizar ni se generan posiciones anteriores. Fuera del antiguo horario tambien se registran acciones consentidas. Si no se obtiene GPS se indica sin coordenadas; la accion de trabajo no se bloquea. Se mantienen aislamiento usuario/trabajador/tenant/sucursal y expiracion tras24h sin verificar sesion. Un cierre forzado antes de persistir la captura o fallo de disco puede impedir registrar ese evento; no se simula una transaccion atomica entre GPS y operacion de negocio.

Historial muestra nombres de acciones y confirmacion/cola por separado del estado de envio del punto. Se conservan los puntos periodicos antiguos como historial; ya no se generan nuevos.

## Mapa negro

Google Maps sigue nativo e independiente del frontend. Se fija apariencia clara y se muestra aviso sobre el mapa cuando no termina de cargar. La consulta real del22-09-2026 sigue devolviendo HTTP403 SERVICE_DISABLED para Places API(New). No hay telefono conectado para leer el error nativo de las teselas; la causa exacta del mapa negro no se certifica solo con la captura.

En Google Cloud revisar Maps SDK for Android, Places API(New), facturacion y restricciones de la clave GOOGLE_MAPS_API_KEY del .env de la app. Paquete com.qualitzer.field; SHA1 B1:A3:1E:CE:4E:B7:53:D1:8E:D2:1A:4D:BB:46:BD:74:81:1F:3B:E4. No quitar restricciones ni cambiar una clave web en uso de forma que rompa la web. Si hace falta una clave Android, configurarla localmente y recompilar. El permiso GPS del telefono no habilita las APIs de Google.

## Servidor

Publicar src/workerLocations actualizado (interfaces, validador y repositorio) y salida compilada si corresponde. Sin migracion nueva; conservar la tabla existente de ubicaciones. Desplegar gateway1.0.22 con sidecars/manifiesto/lock/comprobador, con proceso detenido y drenado:

```sh
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.22.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Arrancar una sola instancia fork. No requiere cambios del frontend. No borrar pendientes cuando el servidor antiguo rechace los eventos nuevos: publicar contrato compatible.

## Verificacion

172 pruebas Mobile/gateway y tipos0; pruebas de permiso concedido/denegado, accion confirmada/offline/fallida, doble pulsacion, captura tras bloqueo, acciones de actividades/equipo/archivos/OT, parada del servicio antiguo, contratoHTTP y consentimiento2. 42 recorridos RNWeb de panel/historial/creacion y6 de mapa/equipo conOS/Google/API simulados.

Backend: pruebas fuente preparadas y editor sin errores; no tests/build/lint/SQL/migraciones/instalacion/reinicio ejecutados. No se verificaron GPS real, permisos reales ni persistencia MySQL de estos eventos. El bloqueo de Google Cloud sigue pendiente.