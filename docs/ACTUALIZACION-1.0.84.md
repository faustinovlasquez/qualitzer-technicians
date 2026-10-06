# Cronómetros activos y Ajustes: APK 1.0.84 / gateway 1.0.35

Mantiene todo lo de la [actualizacion 1.0.83](ACTUALIZACION-1.0.83.md) (nuevo diseño de Materiales) y corrige lo reportado en terreno:

- **El aviso "Cronómetro activo" abre el trabajo correcto.** El servidor informa la primera fecha planificada del trabajo; si el cronómetro sigue abierto días después, la app ahora lo busca hoy y luego entre esa fecha y hoy (máximo 31 días) en lugar de responder "La orden ya no está disponible".
- **Alerta fija de cronómetro activo** arriba de Mi jornada y Agenda, con el trabajo, la OT y el tiempo transcurrido, y un botón "Ver" para pausarlo o terminarlo. Viene del servidor, así que aparece aunque el trabajo no esté en el día que estás viendo. Se actualiza cada 2 minutos y tras cada cambio.
- **El error de un aviso ya no aparece como "No se pudo actualizar la jornada".** Se muestra aparte y se puede cerrar.
- **Perfil como menú de Ajustes** al estilo Android: cuenta, Centro offline, Notificaciones, Apariencia, Firmas, Seguridad, Ubicación, Empresa y sucursal, Conexión, Privacidad y Cerrar sesión. Cada opción abre su detalle y el botón atrás vuelve al menú.

## Servidor

Requiere el backend con `GET /mobile-notifications/active-timers` más todo lo de la 1.0.83, y el gateway 1.0.35. Sin migraciones.

## Verificacion local

1846 pruebas de la app y del gateway pasadas, typecheck sin errores. Backend sin errores de compilación; 2 pruebas nuevas de cronómetros activos.
