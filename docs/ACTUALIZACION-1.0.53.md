# Actualizacion 1.0.53: trabajos dentro del mantenimiento

Android versionCode 54, misma firma y paquete. API derivada del .env existente.
Gateway requerido: 1.0.25. No modifica Google Maps, permisos ni datos guardados.

## Pantalla

- Cabecera con codigo OT sin salto de linea, volver, jornada y actualizar.
- Se retira la tarjeta inicial duplicada de inicio/entrega.
- Barra inferior fija con Iniciar OT, Entregar OT y Crear trabajo, tambien en Archivos.
- Conserva los dialogos y validaciones de inicio y entrega.
- Crear trabajo abre el formulario existente con borrador aislado por OT y equipo heredado no editable.
- Al confirmar vuelve a Trabajos. Si falla la recarga, Gestionar trabajo reintenta solo la lectura; no repite el POST confirmado.
- Registra WORK_CREATED con la referencia del hijo, bajo el consentimiento de ubicacion existente.

Crear dentro de una OT requiere conexion. El backend comprueba sucursal, asignacion vigente y estado abierto, bloquea el padre y crea trabajo, vinculo, responsable y planificacion en una transaccion. Mantiene la idempotencia por UUID. No crea otro mantenimiento.

## Despliegue

Publicar los cambios de src/technicianDashboard: IMobileCreation, MobileCreation,
MobileCreationSequelize.repository, MobileCreationAssignments y MobileCreationAssignments.query.
Publicar tambien su compilado si el servidor lo utiliza. No hay nueva migracion.

Desde la raiz del backend, con el proceso detenido y drenado:

```sh
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.25.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Reiniciar una sola instancia fork, conservando su configuracion, claves y directorio de sesiones.
Instalar la APK como actualizacion, sin desinstalar ni borrar datos, cache o pendientes.

## Verificacion

266 pruebas Mobile/gateway y tipos sin errores. Seis recorridos RN Web a 360,
390 y 1280 px, con texto 100/200%, verifican footer, dialogos, equipo heredado,
retorno al hijo y recuperacion de lectura sin duplicados; 143 comprobaciones.
API, GPS y sistema operativo simulados. Pruebas backend preparadas pero no
ejecutadas; sin tests, build, lint, SQL ni despliegue automatico del backend.
No se ha probado esta creacion contra MySQL real ni en un telefono fisico.