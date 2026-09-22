# Qualitzer tecnicos 1.0.43

APK Android codigo 44, misma identidad y firma. Instalar como actualizacion sobre 1.0.42 sin desinstalar ni borrar datos, sesiones, borradores, colas o recibos.

## Creacion

- Trabajo confirmado: abre la ficha exacta y muestra Trabajo creado exitosamente con Gestionar trabajo.
- Mantenimiento confirmado: abre el mantenimiento padre y muestra Mantenimiento creado exitosamente con Gestionar mantenimiento.
- El aviso se cierra sobre la ficha para gestionar trabajos, actividades y archivos segun los permisos y conectividad existentes.
- Offline: abre la copia local y avisa Guardado en el telefono, pendiente de sincronizar. No afirma exito en el servidor.
- Si no se puede leer la ficha confirmada, conserva el marcador duradero y permite reintentar la apertura sin crear otra solicitud. No abre recursos de otra sesion.

## Historial propio de ubicacion

En trabajo o mantenimiento, pulsar el icono de ubicacion o Mi historial de ubicacion en el menu. Tambien esta disponible en Mi perfil.

Calendario para consultar otros dias, hora en la zona de la sesion, coordenadas, precision, estado sincronizado o pendiente, registros sin posicion y ubicaciones simuladas. Los inicios de este trabajo/orden usan filtros del servidor antes de paginar. Mi recorrido del dia muestra los puntos personales del dia, no los atribuye al trabajo seleccionado. Ver en mapa abre Google Maps con las coordenadas solo al pulsarlo.

Consultar no activa permisos ni seguimiento. La captura mantiene consentimiento, horario y limites del sistema operativo. Los puntos pendientes son visibles offline; consultar puntos ya sincronizados requiere conexion. No se inventan registros de antes de activar el seguimiento ni se muestran ubicaciones de otros empleados. Los datos del telefono no certifican presencia.

## Servidor

Publicar las fuentes actualizadas de `src/workerLocations` del Backend y su salida compilada si corresponde. No hay migracion nueva; la migracion tenant `20260921200000-Create-WorkerLocationHistory.js` de 1.0.39 sigue siendo requisito si aun no fue aplicada. No se ejecuto aqui.

Publicar el paquete 1.0.20, sidecars, referencias del consumidor y comprobador. Con el proceso detenido y drenado, desde la raiz real del Backend:

```sh
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.20.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Arrancar una sola instancia fork, sin reload solapado. Conservar requisitos y datos de sincronizacion de versiones anteriores.

## Verificacion

153 pruebas focalizadas Mobile/gateway y tipos cliente/servidor sin errores. 42 casos RN Web con capturas en 360, 390 y 1280 px, texto normal/ampliado; red, sistema y almacenamiento simulados. Cubren confirmacion/local, apertura exacta, reintento sin duplicado, mantenimiento padre, filtros, pagina, calendario, respuesta tardia, pendientes y mapa explicito.

Backend: pruebas fuente de filtros preparadas y diagnosticos del editor, sin ejecutar tests, lint, build, SQL, migraciones, instalaciones ni reinicios. Falta comprobar servidor desplegado y telefono fisico; las pruebas locales no los certifican.