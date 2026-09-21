# Cronometro sin conexion

APK 1.0.37, codigo Android 38. Requiere gateway 1.0.15 y fuentes Backend MobileSync, TechnicianDashboard y app.logbooks actualizadas. Sin migracion nueva.

## Comportamiento

- Iniciar, pausar y reanudar funcionan sin red sobre un trabajo descargado y autorizado, tanto en listado como en ficha.
- Cada accion se guarda primero de forma durable con su UUID, instante y dependencia anterior. El contador avanza localmente, conserva el tiempo acumulado previo y excluye las pausas. Reabrir la ficha recupera la misma secuencia.
- Guardado local no es confirmacion del servidor. Al recuperar conexion, con la sesion valida y la app en primer plano/desbloqueada, la cola envia las operaciones en orden y con los mismos identificadores.
- El backend suma tramos capturados en mantenimiento y conserva logs temporales para trabajos. No recibe un total del cliente para reemplazar el acumulado.
- La auditoria del efecto se guarda en la misma transaccion, con bloqueo de recurso, identificador y revision. Repetir un envio no duplica el efecto. Si otro dispositivo cambio el estado/datos incompatibles, se conserva el pendiente para revision y no se fuerza la sobrescritura.
- La copia confirmada de la ficha permanece separada del contador local. Respuestas, comentarios, archivos, borradores, recibos y colas previas se conservan. No se modificaron sus contratos.

La app necesita haber descargado el trabajo y disponer de acceso offline vigente; no se habilita ejecucion sobre una creacion aun no confirmada o un recurso revocado. La entrega final y las acciones que antes exigian conexion mantienen esa condicion. No se garantiza envio en segundo plano. Cambiar incorrectamente el reloj del telefono puede requerir revision. Las operaciones antiguas sin instantes capturados conservan su formato; no se reconstruye tiempo que versiones anteriores no registraron.

## Despliegue

Desplegar MobileSync completo, incluyendo MobileSyncRecordedTimerSequelize.repository, sus interfaces/validador y la integracion en MobileSyncOperations/TimerState. Incluir TechnicianDashboardGetAssignmentsUseCase, ITechnicianAssignment y app.logbooks. Instalar gateway 1.0.15 con su manifiesto/lockfile. Detener y drenar el proceso anterior, actualizar salida compilada segun el despliegue y arrancar una sola instancia fork, sin rolling reload solapado. Instalar luego la APK como actualizacion, sin desinstalar ni borrar datos.

Si el backend no anuncia supportsRecordedTimer, la pasarela no envia comandos nuevos y la cola espera la actualizacion. No convertir un pendiente en una solicitud nueva.

## Verificacion

148 pruebas enfocadas de cola durable, reconciliacion, repositorio offline y pasarela aprobadas. Cubren captura/restauracion, pausa excluida, secuencia unica, respuesta perdida, dependencias, conflictos, lectura tardia, copias/recibos y preservacion de datos. Tipos cliente/pasarela sin errores y 92 regresiones adicionales aprobadas.

12 recorridos RN Web con motor/almacenamiento simulados: 239 comprobaciones, 24 capturas, 360/390/1280 px y texto normal/ampliado. Inicio offline, pausa, reanudacion, remonte, listado y reconexion, conservando doce minutos previos y sumando siete segundos una vez. Informe: artifacts/logs/time-sync-ui/2026-09-21T13-52-19-712Z.

Backend: pruebas fuente de contrato, conexion de operaciones, suma, revision externa, replay y rollback preparadas; diagnosticos del editor sin errores. No se ejecutaron tests, lint, build, SQL, instalaciones ni reinicios del backend. No se verificaron cuenta real, telefono fisico ni sincronizacion productiva. La simulacion de almacenamiento del navegador no acredita la durabilidad nativa del dispositivo.