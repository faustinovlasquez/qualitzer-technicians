# Qualitzer tecnicos 1.0.45

APK codigo 46. Instalar como actualizacion, sin desinstalar ni borrar datos, sesiones, colas, recibos o borradores. Misma firma. Gateway 1.0.21 sin cambios; no se genera ni instala un paquete nuevo.

## Diagnostico del mapa

Consulta publica sin credenciales el 21-09-2026: tanto https://demo-grupoeliseo.qualitzer.com como https://demo-mantenimiento-grupoeliseo.qualitzer.com devolvieron HTTP 404 para /api/mobile-map y HTTP 500 para /mobile-map.js. El error sucede antes de cargar Google. La clave en .env de Expo no corrige esas rutas.

En el Frontend local estos dos archivos aparecen nuevos, sin seguimiento Git:

- src/app/api/mobile-map/route.ts
- public/mobile-map.js

Incluir ambos en la publicacion del frontend y reconstruir/reiniciar ese frontend con su procedimiento habitual. Conservar NEXT_PUBLIC_GOOGLE_MAPS_API_KEY existente y sus restricciones al portal. Comprobar GET /api/mobile-map (HTML) y GET /mobile-map.js (JavaScript) con HTTP 200 en el dominio exacto de la sesion; despues comprobar carga de Google. No se realizaron commits, despliegue o reinicios remotos aqui.

La APK sustituye el documento 404 por un aviso con la URL y Reintentar mapa. Usar mi ubicacion conserva el GPS directamente en el formulario aunque el visor no responda. Sin geocodificacion del visor, la direccion se puede completar manualmente antes de guardar. No guarda automaticamente ni modifica la ubicacion del trabajador.

## Historial del trabajador

La lista ahora muestra registro desactivado, sesion vencida, fuera de horario o problema GPS, y ofrece Configurar ubicacion sin salir de la ficha. La captura sigue desactivada hasta que el usuario acepta el consentimiento y permisos. No se habilita silenciosamente ni se generan posiciones retroactivas.

Con seguimiento activo, permisos de ubicacion durante el uso y en segundo plano, GPS habilitado y horario vigente, se obtiene un punto en primer plano como maximo cada cinco minutos aunque el telefono no se mueva. Se rechazan posiciones antiguas, precision insuficiente, cambio de usuario/sesion y resultados tras desactivar el registro. Se mantiene el servicio nativo en segundo plano con sus limitaciones de Android y expiracion de sesion verificada de 24 horas.

Los puntos pendientes son locales; se suben con la app abierta y conectada. El historial se vuelve a consultar al confirmarse una sincronizacion. Cero puntos sincronizados no demuestra por si solo un fallo del GPS: revisar el estado y la fecha. Falta confirmar permisos/configuracion del telefono de la captura.

## Verificacion

163 pruebas Mobile/gateway y tipos cliente/servidor sin errores. Seis recorridos RN Web con mapa/GPS/API simulados, incluidos mapa 404 con GPS utilizable, guardado, permisos y conflictos. Pruebas del runtime verifican primer punto sin movimiento, intervalo, consentimiento, permisos, horario, precision y expiracion; no equivalen a GPS fisico.

Sin cambios de runtime Backend/Frontend en esta correccion, sin tests/build/lint/SQL/migraciones de esos repositorios. El despliegue remoto sigue pendiente. No se certifica captura en el telefono ni persistencia productiva.