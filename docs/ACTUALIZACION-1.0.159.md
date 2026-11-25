# Actualización 1.0.159 (gateway 1.0.54)

Misma app que la [1.0.158](ACTUALIZACION-1.0.158.md), más lo que la web ya tenía en "Editar mantenimiento"
(plan `Plan-mantenimiento-web-a-app.md`, etapas 0 a 4):

- **Prioridad de 5 niveles** (Muy alta a Muy baja) al crear un mantenimiento; la agenda ya no convierte "Muy alta" en media
  y cada trabajo del mantenimiento muestra su prioridad real.
- **"Nuevo mantenimiento"** muestra lo mismo que la web según el tipo, sin obligar a llenarlo: título y motivo opcionales;
  tipo con su color e ícono y prioridad en la misma fila; "Solicitado por"; fecha de reporte y "Detenido desde" plegadas en
  una casilla (sin marcar se usa la hora de creación); análisis de la falla plegado (sistema, causa, método de detección,
  severidad y tipo de daño causado); en detención, otros activos afectados (equipos o implementos) y tiempo de interrupción.
  El equipo elegido se ve con su insignia ("Elegido" / "Falta elegir"). "Salir sin guardar" descarta el borrador.
- **Pestaña "Información"** en la ficha del mantenimiento: ver todo lo anterior y editarlo (permiso de app
  "Editar mantenimientos", encendido por defecto; se puede apagar por sucursal en "Configura la app").
- **Pestaña "Recursos"**: agregar productos del catálogo de la sucursal, cambiar cantidades y quitarlos.
- **Trabajos**: tipo de trabajo, acción y motivo de intervención al agregar un trabajo y en "Editar trabajo" (además del
  tiempo asignado cuando el trabajo no tiene horario); se ven en la tarjeta y en el detalle del trabajo.
- "Editar trabajo" muestra el equipo como "N.º interno 6 · DKGX-66" (antes "Equipo 6").

Correcciones:

- Una OT creada desde el teléfono seguía en "Mi jornada" hasta 14 días después de borrarse, reasignarse o de que el técnico
  se quitara del equipo, sin poder iniciarla ni entregarla (caso reportado el 19-11). La app ahora la quita en cuanto la
  agenda del servidor, pedida después de confirmar la creación, ya no la trae. Los teléfonos que ya la tienen guardada la
  dejan de mostrar al actualizar la jornada con esta versión.
- El calendario de fechas abría en enero de 2000 cuando la fecha estaba vacía; ahora abre en el mes actual.
- "Nuevo" volvía a mostrar el mantenimiento recién creado; ahora empieza vacío.
- El tiempo asignado editado no llegaba a la agenda; el encabezado del mantenimiento mostraba el motivo o "Mantenimiento
  interno" en vez del título; los productos mostraban etiquetas HTML en su descripción.

## Notas de la versión para Google Play

<es-419>
Ve y edita la información del mantenimiento: análisis de la falla y otros activos afectados.
Agrega productos al mantenimiento desde la app.
Clasifica cada trabajo con tipo de trabajo, acción y motivo de intervención.
Correcciones: una OT de la que te quitaste ya no queda en tu jornada.
</es-419>

## Orden para publicar

1. Respaldo de la base del entorno.
2. Migraciones del 25-11, **antes** del servidor (sin ellas la agenda de la app falla):
   `20261125100000-Create-Maintenance-Failure-Catalogs`, `20261125100000-Create-MaintenanceWorkTypes`,
   `20261125100100-Add-Failure-Analysis-Fields-To-Maintenances`, `20261125100100-Create-MaintenanceInterventionReasons`,
   `20261125100200-Add-Classification-To-MaintenanceWorks`, `20261125100200-Create-Maintenance-Affected-Assets`.
3. Seeders neutral: `20261125110000-Seed-MaintenanceFailureCatalogs`, `20261125120000-Seed-MaintenanceWorkTypes`,
   `20261125140000-Seed-MaintenanceInterventionReasons` (sin ellos los campos se ven, pero sin opciones).
4. Backend con estos cambios y la pasarela 1.0.54 (va dentro del backend).
5. Web (permiso "Editar mantenimientos" en "Configura la app").
6. APK 1.0.159 (código 160) / AAB para Play Console.

Con un backend anterior, la app 1.0.159 sigue funcionando: Información y Recursos avisan que hay que actualizar el servidor,
y la creación no envía los campos nuevos si no se llenan.
