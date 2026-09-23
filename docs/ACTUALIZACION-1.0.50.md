# Actualizacion 1.0.50: editar trabajos y asociar equipo

Android versionCode 51, mismo paquete y firma. URL derivada de BACKEND_URL en el
.env de la app; no se incorporan dominios al codigo. Gateway requerido: 1.0.23.

## Cambios

- Editar trabajo abre CreationScreen en modo edicion, con los mismos campos,
  catalogos, calendario y selectores horarios del formulario de creacion.
- Precarga titulo, descripcion, prioridad, especialidad, equipo y horario.
- Guarda sobre el registro existente con revision esperada; no crea otro trabajo.
- Un conflicto mantiene el formulario y solicita reabrir la ficha.
- Si se confirma el guardado y falla la lectura posterior, reintentar solo vuelve
  a cargar la ficha; no repite el PATCH.
- Asociar equipo aparece en la ficha sin equipo de un trabajo directo y abre
  el mismo formulario. La seleccion usa el catalogo autorizado por sucursal.
- Los trabajos de mantenimiento muestran el equipo del mantenimiento con
  prioridad sobre cualquier equipo antiguo del trabajo vinculado.

## Limites de seguridad

La edicion requiere conexion, sesion desbloqueada, asignacion actual y ausencia
de pendientes del grupo. No se agrega un comando offline de edicion.
Los trabajos entregados o completados no admiten cambios desde este formulario.
El horario solo puede modificarse cuando existe una planificacion movil unica,
sin pausas, un trabajador y sin ejecucion previa. No modifica cronometros,
registros de horas, estados, respuestas ni archivos.
Equipo heredado y especialidad del hijo de mantenimiento son de solo lectura.
Un trabajo de mantenimiento sin enlace al trabajo canonico no admite esta edicion.
Cambiar el titulo del hijo no cambia el nombre ni la fecha de la OT padre.

El backend verifica la asignacion otra vez dentro del guardado transaccional,
bloquea filas, compara revision y registra auditoria. La respuesta historica de
creacion queda intacta para conservar idempotencia.

## Despliegue

Publicar PanelWorkEdit (domain, application, infrastructure),
PanelWorkActions.dependencies, TechnicianDashboard.routes y
PanelEquipmentLocationUseCase del backend.
Si se ejecuta JavaScript compilado, actualizar tambien ese resultado mediante
el procedimiento de despliegue del servidor. No hay migraciones nuevas.

Desde la raiz del backend, con el proceso detenido y drenado:

```sh
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.23.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Iniciar una sola instancia fork. Conservar directorio, clave y sesiones del
gateway operativo. No repetir el reinicio limpio utilizado para configurar
por primera vez el entorno de desarrollo.

Instalar la APK como actualizacion, sin borrar datos ni pendientes.

## Verificacion

170 pruebas Mobile/gateway y tipos de app/gateway sin errores. Seis flujos
React Native Web en 360, 390 y 1280 px, texto 100/200 por ciento, comprueban
precarga, titulo/descripcion/fecha, equipo, herencia y conflicto.
API y sistema operativo simulados. No acredita escrituras MySQL reales,
instalacion en telefono ni el despliegue remoto. Pruebas fuente backend
preparadas, no ejecutadas; no se corrio lint, build ni SQL en backend.