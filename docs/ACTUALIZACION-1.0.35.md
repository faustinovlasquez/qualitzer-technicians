# Creacion de trabajos simplificada

APK 1.0.35, codigo Android 36, gateway 1.0.13. Requiere desplegar las fuentes de backend MobileCreation y MobileNotifications y la nueva pasarela antes de usar los campos opcionales. Sin migracion nueva.

## Cambios

- Para trabajos, descripcion y horas de inicio/fin son opcionales e independientes. Titulo y fecha siguen siendo necesarios. Si ambas horas existen se valida el rango; no se inventan horas ni duracion. Mantenimiento y tiempo no productivo conservan sus reglas previas.
- Se pueden quitar horas ya elegidas. La agenda conserva el trabajo en su fecha aunque no tenga horario completo.
- Con conexion comprobada, crear espera hasta ocho segundos por la confirmacion persistida de la misma operacion. Si tarda mas o falla la red, queda en la cola con el mismo UUID. La llegada posterior de la respuesta se reconcilia sin un segundo envio.
- Se elimina el aviso rojo redundante de creacion pendiente; la ficha local mantiene su estado pendiente y la ejecucion requiere confirmacion y autorizacion del servidor.
- La auditoria de nuevas creaciones propias registra los IDs de responsable y planificacion. El reconciliador no genera su aviso de asignacion; una membresia externa distinta sigue notificandose. Los recordatorios de cronometro siguen activos. No se borran avisos historicos.

## Despliegue

1. Desplegar fuentes del backend, incluyendo MobileCreation (dominio, interfaces, repositorio y resolucion horaria) y MobileNotifications (dominio, origenes y caso de uso).
2. Instalar el artefacto local versionado gateway 1.0.13 con el manifiesto y lockfile preparados. Detener y esperar la salida del proceso anterior; iniciar una sola instancia fork, sin rolling reload solapado. Preservar claves y sesiones.
3. Instalar APK 1.0.35 como actualizacion. No desinstalar ni borrar colas, datos o borradores. No recrear trabajos pendientes.

El esquema actual de planificacion conserva horas ausentes como cadenas vacias y minutos no planificados como cero; la respuesta de creacion expresa duracion desconocida como null. Los payloads anteriores completos conservan su normalizacion e idempotencia.

## Verificacion

101 pruebas enfocadas de formulario, rutas de pasarela y repositorio offline aprobadas. Incluyen campos vacios, horarios parciales, espera acotada, respuesta perdida, confirmacion tardia y preservacion de UUID. Tipos de cliente y pasarela sin errores; 92 regresiones adicionales aprobadas.

24 recorridos RN Web a 360/390/1280 px y texto normal/ampliado, 1679 comprobaciones y 72 capturas: artifacts/logs/time-sync-ui/2026-09-21T12-35-10-088Z. Usan limites de API/almacenamiento simulados, sin escrituras de negocio.

Backend: pruebas fuente de validacion, origenes y notificaciones actualizadas; diagnosticos del editor sin errores. No se ejecutaron tests, lint, build, SQL, instalaciones ni reinicios del backend. No se verifico la cuenta real, la operacion mostrada en la captura, el envio push productivo ni un telefono fisico. El responsable del servidor debe completar el despliegue y la comprobacion autenticada.