# Entrega tecnica simplificada: 1.0.28

- Formulario de entrega con nota tecnica, duracion y firma del tecnico. Mantiene seleccion, alta y edicion de firmas del perfil y dibujo manual.
- Boton naranja Entregar OT debajo de Archivos del mantenimiento.
- Aviso antes del formulario con trabajos sin entregar y checklists incompletos. Continuar solo abre el formulario; cancelar no escribe.
- La entrega confirmada marca la OT y todos sus trabajos como entregados, incluso con checklists pendientes. No responde pasos ni inventa evidencias.
- Tras entregar el ultimo trabajo, una consulta fresca de todos los hijos puede ofrecer entregar la OT ahora o mas tarde. No se dispara por trabajos solo completados, ordenes vacias, datos locales o escrituras rechazadas.

## Servidor obligatorio

Desplegar las fuentes actualizadas de maintenances, los manifiestos y el paquete gateway 1.0.11. El nuevo endpoint es POST /api/maintenances/:id/technician-delivery?companyBranchId=N. Recibe note, durationMinutes, technicianSignature y acknowledgeDelivery:true. Valida sesion, sucursal y asignacion, y entrega padre/hijos/firma en una transaccion; conserva tiempos y detiene relojes activos. Actualiza el tiempo y estado de trabajos vinculados sin cambiar responsables ni planificacion. La finalizacion del supervisor y el endpoint legacy permanecen separados.

Detener y drenar el proceso anterior, instalar el gateway nuevo y arrancar una sola instancia fork. No rolling reload con escritores solapados. Seguir docs/ACTUALIZACION-ASIGNACIONES-MOVILES.md del Backend. Sin migracion nueva ni cambio de claves/Firebase.

Instalar como actualizacion sobre la APK anterior. No desinstalar, borrar datos, SQLite, colas, borradores ni recibos. La entrega requiere conexion; no se encola ni se reintenta automaticamente. Ante respuesta incierta, actualizar la OT antes de repetir.

## Verificacion

89 pruebas enfocadas del cliente y gateway; 12 recorridos de componentes reales RN Web, con 334 aserciones y 42 capturas a 360, 390 y 1280 px, texto 100/200 %. API y sistema operativo simulados. Pruebas Backend agregadas como fuentes, no ejecutadas por las reglas del repositorio. No se ejecutaron SQL ni mutaciones reales. La validacion local no sustituye comprobar el despliegue remoto y un telefono fisico.