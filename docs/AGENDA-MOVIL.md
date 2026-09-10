# Agenda legible en teléfonos

## Diseño implementado

- Por debajo de 600 px: agenda diaria de tarjetas cronológicas a ancho completo. No hay cuadrícula de 24 horas ni columnas estrechas para los cruces.
- Una sola superficie de desplazamiento vertical contiene navegación, siete días, avisos y trabajos. Los controles no dejan atrapado al usuario en una pequeña ventana de contenido.
- Barra compacta: semana anterior/siguiente, rango, filtros/OTs y actualizar. La vista ampliada de lista conserva búsqueda, filtros, OTs, acciones y cronómetros activos.
- Los siete días caben en el ancho; fecha seleccionada, hoy, carga y cobertura tienen etiquetas accesibles. Incluso un día sin copia es seleccionable para explicar su estado, sin saltar silenciosamente a otra fecha.
- Día/Semana cambia entre tarjetas de un día y secciones cronológicas de los siete días. Las tarjetas muestran horas exactas, planificación, título completo, estado real, origen y equipo.
- Atrasados y trabajos sin horario permanecen en un apartado explícito con conteo y acceso al detalle. No se agregan a las horas de los bloques.
- Los solapamientos son avisos de horarios coincidentes; no se suman como disponibilidad. Los trabajos nocturnos conservan sus fragmentos y abren la planificación original.
- A partir de 600 px se mantiene la cuadrícula, sus vistas Día/Semana, saltos horarios, leyenda y carga.
- El FAB se ancla al pie del área de contenido, por encima de la navegación, sin compensaciones verticales arbitrarias. En desarrollo se coloca a la izquierda para no coincidir con el QR de Expo; en producción, a la derecha. Se reserva espacio al final de la agenda y la lista para poder desplazar el último contenido fuera del FAB.

## Integridad de datos

Se reutiliza `buildWeeklySchedule`: no se cambian deduplicación, snapshots diarios, permisos, fuentes de datos, hook de selección ni motor offline. La fecha se comunica antes de abrir el trabajo y se conserva al volver. No se infiere capacidad de jornada ni tiempo ejecutado a partir de las horas planificadas.

El reloj usa la zona de sucursal y se actualiza cada minuto; sin zona válida se indica que no está disponible. No actualiza estados de trabajos ni pretende sustituir la sincronización. La carga parcial, actualización en curso y errores se distinguen de una agenda vacía. El estado de conexión y su fecha de datos siguen siendo responsabilidad del encabezado existente.

## Validación aislada

- Pruebas específicas: `tests/weekly-schedule.test.ts`, `tests/canonical-assignment-works.test.ts` y `tests/agenda-presentation.test.ts`: 34 pruebas correctas.
- Typecheck de la app móvil con su Node 22 local; sin lint, build ni validaciones de backend/frontend.
- E2E propio: `tests/e2e/agenda-layout-smoke.cjs`, ejecutado con Node local y el loader de `tsx`. Levanta una instancia propia del fixture existente en 8788 únicamente si el puerto está libre y la cierra al terminar. No modifica el fixture ni los E2E de encabezado.
- Edge headless en contextos nuevos, 320/360/390 y 1280 px: siete días dentro del ancho, tarjetas completas sin recorte de título, primer trabajo visible, ausencia de overflow, vacío claro, cruces, deduplicación, noche, selección al regresar, filtros/OTs, menú de creación y separación FAB/QR. Solo se permite login ficticio; se bloquean escrituras de negocio y cualquier origen ajeno a Metro/fixture.
- Capturas y resultados se guardan en una carpeta temporal `qualitzer-agenda-layout-*`. Metro 8081 y gateway 8787 no se reinician; no se usa almacenamiento, sesiones ni credenciales reales.

## Límites reales

La inspección automatizada es web con viewport móvil, no prueba física de Android/iOS, teclado nativo, TalkBack/VoiceOver o tamaños de fuente extremos. Las tarjetas largas y semanas muy cargadas requieren desplazamiento vertical. La lista semanal no está virtualizada; conserva el límite de datos de la consulta existente. El QR es solo de desarrollo y no forma parte de la versión de producción.