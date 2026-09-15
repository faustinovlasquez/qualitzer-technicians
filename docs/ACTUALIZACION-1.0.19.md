# Qualitzer tecnicos 1.0.19

## Navegacion

- La flecha del trabajo vuelve a la vista anterior: archivos de un paso, checklist, ficha y finalmente pantalla de origen. No sale directamente al listado desde Archivos.
- El checklist conserva su posicion al abrir evidencia. Su regreso recorre los pasos visitados, el resumen y el catalogo sin modificar respuestas.
- Las pestanas del trabajo permanecen arriba en una fila desplazable. Inicio abre la ficha del trabajo; Listado sale directamente a las asignaciones.
- En OT y mantenimiento, el regreso recorre sus pestanas antes de salir. Inicio vuelve al resumen y Listado sale a asignaciones.
- En creacion, la flecha retrocede entre Datos, Horario y Revisar. La salida explicita mantiene la confirmacion de borradores.
- Perfil, Avisos y Agenda tienen regreso a la vista anterior e inicio en Mi jornada. El historial se limita a la sesion y sucursal vigentes.
- Durante una operacion o almacenamiento de archivos en curso se bloquea la navegacion para conservar los cambios.

## Ficha

- Eliminada la seccion Instrucciones del trabajo. Las actividades se muestran primero.
- Cada actividad tiene tarjeta propia, nombre destacado, minutos, estado y acciones. La recien creada aparece primero con marca temporal y la ficha se desplaza hasta ella.
- Archivos de actividad se abre en una vista propia con regreso a las actividades.
- Checklist y materiales tienen separadores y encabezados propios. Los materiales vacios no se muestran; los repuestos vacios tampoco aparecen en las pestanas de la orden.
- Responsables compactos y reporte tecnico plegable. Las acciones de ejecucion siguen fijas abajo.

## Instalacion

Instalar la APK 1.0.19, codigo 20, sobre la anterior sin desinstalar ni borrar datos. Conserva paquete, firma, conexion remota, borradores y pendientes.

Esta entrega no requiere cambios adicionales de backend, gateway ni base de datos respecto de 1.0.18. Sigue usando gateway 1.0.7 y los endpoints de actividades de la entrega anterior. No se cambia Firebase.

Validacion local: pruebas focalizadas de navegacion, checklist, creacion, actividades, seguridad y entrega; tipos de los archivos modificados; seis recorridos con componentes reales React Native Web a 360, 390 y 1280 px, texto 100/200 %. Los servicios son simulados: no acredita pruebas en telefono fisico ni operaciones remotas. No se ejecutan pruebas, SQL ni build del backend.

Resultado: 266 pruebas aprobadas y cero errores de tipos; seis recorridos visuales aprobados con 191 aserciones y 48 capturas. APK release verificada el 15 de septiembre de 2026 a las 17:58:54 UTC, 69755139 bytes. SHA-256: `1b4ba830334068de584fd87003173e67ef3f0c04adf78bb5bd1193f10f1b9dee`. Misma firma y fuentes compiladas verificadas; APK 1.0.18 conservada.