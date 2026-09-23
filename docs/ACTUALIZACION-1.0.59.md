# Actualizacion 1.0.59: badges de asignaciones

Android versionCode 60, misma firma y paquete.

- Trabajos, Mantenimientos y OTs muestran sus cantidades junto al nombre.
- Los tipos cuentan las coincidencias del periodo, busqueda y estados activos.
- Todos, Pendientes, En curso y Completados cuentan los elementos del tipo y busqueda seleccionados, antes de aplicar el filtro de estado.
- En curso incluye pausados y Completados incluye entregados, sin cambiar las reglas existentes.
- Mantenimientos y OTs cuentan padres, incluidos los asignados sin trabajos; Trabajos cuenta los hijos visibles.
- Sin datos o con cobertura sin verificar se muestra un guion; con cobertura parcial y elementos conocidos se muestra el numero seguido de +. No se interpreta una copia incompleta como cero asignaciones.
- Badges con contraste para seleccion, nombres accesibles y filas desplazables para letra ampliada.

No modifica operaciones, cronometros, permisos, sesiones, colas, API ni clave
Google. No cambia backend, frontend ni gateway. Instalar la APK como
actualizacion, sin desinstalar ni borrar datos.

## Verificacion

Siete pruebas de filtros/navegacion pasan y el chequeo de tipos acotado no
reporta errores. Seis recorridos RN Web a 360/390/1024 px con letra 100/200%
verifican tipos, estados, padres sin hijos, busqueda, conteos de tres digitos,
cobertura parcial y ausencia de escrituras; 12 capturas revisables.
API y almacenamiento del escenario simulados; no prueba de telefono fisico
ni operaciones remotas. No tests/build/lint/SQL del backend.

## Gateway Actual

La ultima version disponible sigue siendo 1.0.27. Para instalarla despues de
publicar sus artefactos y referencias, con el proceso detenido y drenado,
desde la raiz del backend:

```sh
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.27.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Reiniciar una sola instancia fork tras comprobar ambos pasos. Conservar
configuracion, claves y directorio de sesiones. Si ya esta instalada 1.0.27,
no es necesario reinstalarla por los badges. Ese gateway agrega diagnostico
del fallo previo de edicion; esta mejora visual no acredita que dicho fallo
remoto este resuelto.