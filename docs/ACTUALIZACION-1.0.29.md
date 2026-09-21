# Entrega tecnica simplificada y guiada: 1.0.29

Version final de esta entrega, codigo Android 30. Sustituye la compilacion intermedia 1.0.28, conservada sin sobrescribir.

- Solo nota tecnica, duracion y firma del tecnico en el formulario. Mantiene firmas del perfil y dibujo manual.
- Boton naranja Entregar OT debajo de Archivos del mantenimiento.
- Confirmacion previa con trabajos sin entregar y checklists incompletos. Cancelar no escribe; continuar abre el formulario.
- Al confirmar, OT y todos sus trabajos quedan entregados, incluso con checklist incompleto. Respuestas y evidencias no se modifican.
- Tras entregar el ultimo trabajo confirmado, ofrece entregar la OT ahora o mas tarde. Consulta todos los hijos sin cache. La solicitud se consume en la navegacion para no reaparecer al regresar al detalle.

## Actualizacion obligatoria del servidor

Desplegar las fuentes actualizadas de maintenances y gateway 1.0.11 antes de usar esta entrega. POST /maintenances/:id/technician-delivery?companyBranchId=N exige sesion, sucursal, asignacion, firma PNG y acknowledgeDelivery:true. Entrega padre, hijos, firma y estado/tiempo de trabajos vinculados en una transaccion; detiene relojes activos y conserva checklist. No cambia la finalizacion del supervisor ni el endpoint legacy.

Seguir docs/ACTUALIZACION-ASIGNACIONES-MOVILES.md del Backend: detener y drenar, instalar el TGZ versionado, actualizar fuentes/salida compilada segun el proceso y arrancar una sola instancia fork. Sin rolling reload solapado ni migracion nueva. El gateway 1.0.11 no cambia respecto de la compilacion 1.0.28.

Instalar la APK como actualizacion. No desinstalar, borrar datos, SQLite, claves, colas, borradores ni recibos. Ante respuesta incierta, consultar estado antes de repetir; entrega online sin reintento automatico.

## Verificacion local

89 pruebas enfocadas de cliente/gateway, incluidos bloqueo, errores, orden vacia, trabajo completado no entregado, entrega desde tarjeta/detalle y consumo de la sugerencia. Tipos cliente/servidor sin errores. 12 recorridos RN Web con 334 aserciones y 42 capturas a 360/390/1280 px y texto 100/200 %, con API y OS simulados. Pruebas Backend agregadas como fuentes pero no ejecutadas; sin tests, build, lint ni SQL del Backend. Servidor remoto y telefono fisico pendientes de comprobacion tras despliegue.