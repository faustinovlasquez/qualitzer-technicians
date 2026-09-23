# Actualizacion 1.0.51: historial de acciones y diagnostico de Google

Android versionCode 52, misma firma y paquete. Destino derivado del .env, sin
dominios propios incorporados en codigo. Gateway requerido: 1.0.24.

## Ubicaciones

- Solicita una posicion del momento de la accion; no reutiliza deliberadamente
  una posicion anterior de hasta un minuto.
- Espera a conservar el punto en el dispositivo antes de terminar la accion.
  Si el GPS no responde o no cumple precision/frescura, conserva la accion sin
  coordenadas; no inventa ubicaciones ni rechaza el trabajo por ese motivo.
- Intenta sincronizar inmediatamente; los fallos conservan pendientes con
  reintentos. Sincronizar ubicaciones permite reintentar manualmente.
- Crear trabajo, crear mantenimiento y editar trabajo/equipo se agregan a las
  acciones ya registradas: actividad, archivos, checklist, comentario, reporte,
  ejecucion de trabajo, inicio/entrega de orden y ubicacion de equipo.
- El historial de la ficha se abre en el dia actual de la sucursal, no en la
  fecha planificada del trabajo. La hora de sincronizacion usa esa misma zona.
- Mantiene consentimiento, permisos durante el uso, TTL y aislamiento de
  usuario/sucursal. No captura por navegar ni en intervalos o segundo plano.

Sin coordenadas no significa accion perdida. Sin confirmacion de negocio no
se guarda una accion como realizada. Una creacion en cola conserva su referencia
local y aparece en el historial del dia; no se captura otra vez al sincronizar.
Los puntos anteriores no se borran ni se reconstruyen retroactivamente.
No existe una transaccion atomica entre la API y el almacenamiento del telefono:
un cierre forzado o fallo de almacenamiento aun puede impedir un registro.

## Google Maps

Ver configuracion de Google muestra paquete, SHA-1 real, presencia de clave y
estado de Google Play Services, sin exponer la API key.
Comprobar acceso a Google ejecuta una consulta publica de prueba a Places API
(New), con una direccion fija, sin coordenadas, credenciales ni datos de trabajo.
Muestra HTTP y codigos seguros, con indicacion especifica para SERVICE_DISABLED,
API_KEY_ANDROID_APP_BLOCKED, API_KEY_SERVICE_BLOCKED y BILLING_DISABLED.

El preflight del 22-09-2026 a las 21:03 UTC devolvio HTTP403 SERVICE_DISABLED
para Places API (New). Debe habilitarse en el proyecto de la clave. Revisar
tambien Maps SDK for Android, facturacion y restricciones de paquete/certificado.
No quitar restricciones de una clave web: usar una independiente para Android.
La prueba de Places no confirma autorizacion de las teselas de Maps; el mapa
del telefono no se da por corregido sin esa configuracion y prueba nativa.

## Creacion

Se eliminan referencias a solicitudes en los formularios de trabajo y
mantenimiento. Se crea directamente. Los estados offline y de confirmacion
incierta se conservan para evitar duplicados; no son aprobaciones pendientes.

## Despliegue

Publicar src/workerLocations/domain/interfaces/IWorkerLocation.ts y
src/workerLocations/domain/WorkerLocationValidation.ts (y compilado si se usa).
No hay nuevas migraciones ni cambios de frontend o de mantenimiento.

Con backend detenido y drenado, desde su raiz:

```sh
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.24.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Iniciar una sola instancia fork. Conservar claves, sesiones y colas existentes.
Instalar APK como actualizacion, sin borrar datos.

196 pruebas Mobile/gateway y tipos sin errores; 42 recorridos de historial y
6 de mapa/diagnostico con RN Web y limites OS/API simulados. No tests/build/lint
backend ni SQL, escrituras remotas o prueba de GPS fisico. El diagnostico nativo
requiere instalar esta APK para ejecutarse en el telefono.