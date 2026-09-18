# Qualitzer tecnicos 1.0.22

## Apertura sin conexion

La app recupera primero la sesion verificada guardada y sus trabajos desde SQLite. Ya no necesita esperar a que una consulta de internet falle para abrir la copia local.

- La informacion descargada de trabajos, checklist, actividades, materiales y equipo sigue disponible tras cerrar y volver a abrir la app.
- Si hoy no tiene copia, abre la semana de la ultima descarga, conservando las fechas originales. Los dias faltantes no se presentan como descargados.
- Las creaciones pendientes se conservan tambien si no hay una descarga previa de trabajos.
- Al volver la conexion, verifica la sesion y actualiza en segundo plano sin vaciar previamente los trabajos visibles. Las operaciones pendientes mantienen sus IDs y recibos.
- Los campos de actividad/checklist, sistema/componente y datos del mantenimiento se conservan al leer la copia.

## Uso

1. Ingresar con internet y cargar los trabajos. La carga guarda automaticamente la copia; comprobar los dias descargados en el Centro offline. Esperar cualquier descarga adicional antes de salir de cobertura.
2. Cerrar la app normalmente, sin cerrar sesion ni borrar datos.
3. Abrirla sin internet y desbloquearla si tiene PIN o biometria. Se muestra la informacion descargada, con sus fechas y estado de conexion.
4. Al recuperar internet, mantener la app abierta y desbloqueada para verificar y sincronizar. Tambien puede usarse Sincronizar ahora.

Los datos nuevos del servidor no se pueden conocer sin conexion. Un enlace a un documento no significa que sus bytes esten descargados: fotos y documentos requieren una copia local previa. Entrega, edicion de actividades y otras acciones online conservan sus restricciones existentes. No se incorporan nuevos tipos de operaciones a la cola en esta version.

Cerrar la app no equivale a cerrar sesion. Una sesion revocada, un cambio de cuenta o un cierre de sesion explicito no permiten reutilizar la copia sin autenticacion. La revocacion bloquea el acceso pero no borra trabajos ni pendientes, para recuperarlos con la misma cuenta tras verificarla. No se cambian claves, namespaces, cuotas ni el nombre de la base SQLite existente.

## Instalacion y verificacion

APK 1.0.22, codigo Android 23. Instalar como actualizacion sobre la app actual; no desinstalar ni limpiar datos. Misma firma, identificador y API. Sin cambios de backend, gateway 1.0.8, Firebase ni migraciones.

354 pruebas moviles enfocadas aprobadas y cero errores de tipos en el alcance revisado. Prueba nueva con los modulos reales de repositorio SQLite, perfiles y hook de aplicacion: descarga, cierre y reapertura de conexion SQLite en disco, arranque en otra semana sin llamadas de red, lectura de ficha y pendientes, fallo 503 sin perdida de copia, reconexion y sincronizacion, y revocacion 401 sin borrado.

El adaptador nativo Expo se sustituye por SQLite de Node en esa prueba; sesion segura y red son puertos simulados. Se conserva el proceso de almacenamiento real y sus transacciones, pero no es una prueba de apagado o cierre forzado en Android. No habia telefono ni emulador conectado; pendiente verificar ese recorrido en el dispositivo. No se ejecutaron SQL, pruebas o cambios del backend.