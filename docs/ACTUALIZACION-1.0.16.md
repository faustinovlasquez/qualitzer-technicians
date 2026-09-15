# Qualitzer tecnicos 1.0.16

APK Android firmada, codigo 17. Actualizar sobre la version instalada; no desinstalar ni borrar sesiones, borradores o pendientes.

## Cambios

- Confirmacion de entrega de trabajo o mantenimiento con icono animado, transicion y acciones Volver a mis trabajos / Consultar detalle. Solo aparece tras una respuesta satisfactoria; en demo indica su alcance local. Respeta movimiento reducido.
- Encabezado de trabajo y cronometro compactos, sin el bloque interior grande. Franja persistente de entregado/finalizado en todas las pestanas, incluidos Archivos y Checklist; tarjetas cerradas con color diferenciado.
- Reapertura explicita de un trabajo entregado, nunca finalizado. Conserva las horas registradas, actividades, respuestas y archivos. En trabajo estandar comienza una nueva sesion pendiente; en mantenimiento conserva el acumulado y queda pausado.
- Materiales y responsables en bloques compactos, checklists con acceso directo a la lista correspondiente y actividades normales separadas de los checklists internos.
- El tecnico puede crear actividades con nombre y tiempo, revisar documentos del supervisor, guardar archivos de evidencia por actividad y marcar cada actividad completada.
- Las actividades y la reapertura requieren conexion y backend actualizado. Sus archivos seleccionados se conservan como borrador hasta confirmacion; no se han agregado acciones nuevas a la cola offline.

## Servidor requerido

Desplegar las fuentes PanelWorkActions preparadas en Qualitzer2.0-Backend y el gateway 1.0.5. No basta con actualizar la APK.

Guia: `Qualitzer2.0-Backend/docs/ACTUALIZACION-ACTIVIDADES-MOVIL.md`.

El paquete y su manifiesto estan en `Qualitzer2.0-Backend/infrastructure/mobile-gateway`. La dependencia y el lockfile apuntan a 1.0.5. No se instalaron dependencias, ejecutaron pruebas/build/SQL ni reiniciaron servicios de backend en esta preparacion. No se agregan migraciones.

## Verificacion

- APK: `artifacts/qualitzer-tecnicos-1.0.16-android.apk`, 69.735.559 bytes.
- SHA-256: `7511bf8278a669a4de2b34a18d7f42b8beb2b06bb6958871965b0fe9206f9f04`.
- Firma conservada: `06da359352b67f02805c065a4f7054fc863cc606221dfe054462f261da32b510`.
- Gateway 1.0.5: 585760 bytes, SHA-256 `91921cb86b16aa774ae7cc1a5dcd9caac47c5a0510fd6e9b6da8bba92621d8a0`.
- Suite movil: 1.677 aprobadas, 1 omitida, 0 fallos; tipos de app, pruebas de cliente y pasarela sin errores. Las pruebas de backend nuevas quedan preparadas para el operador.
- UI real en RN Web: 6 recorridos completos, 119 aserciones, 36 capturas, sin errores. Anchos 360/390/1280 y texto 100/200%; creacion/completado de actividad, consulta de documentos, entrega con exito, estado visible en Archivos y reapertura.
- El gateway se genero dos veces con bytes identicos; carga CommonJS aislada en Node20.12.2 y copia al backend verificadas. Los artefactos anteriores no se reemplazan.
- Pruebas con datos ficticios; no se entregaron tareas, reabrieron trabajos ni cargaron archivos de una cuenta real. No se acredita funcionamiento remoto hasta el despliegue y prueba autorizada.

Ante una respuesta incierta al crear o cargar, actualizar la lista y verificar el resultado antes de repetir. No se afirma entrega exactamente una vez ante errores de red.