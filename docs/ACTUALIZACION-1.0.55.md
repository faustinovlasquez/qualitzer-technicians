# Actualizacion 1.0.55: trabajos de mantenimiento y boton +

Android versionCode 56, misma firma y paquete. Conserva la clave Android de
Google configurada para 1.0.54 y la API definida en el .env privado.

## Correccion

La proyeccion de asignaciones puede devolver una misma OT en varios bloques
horarios cuando se crea un hijo. El gateway exigia una sola fila del padre y
devolvia ASSIGNMENT_NOT_FOUND aunque el mantenimiento siguiera asignado.

Gateway 1.0.26 admite los bloques compatibles de esa OT para consultar estado,
iniciar, entregar y consultar archivos. Busca el trabajo seleccionado en todos
los bloques. Sigue rechazando IDs ajenos, duplicados ambiguos, estados o datos
contradictorios, sucursales ajenas e hijos que no pertenecen al detalle de la OT.
Crear conserva la relacion, equipo heredado, UUID y reintentos existentes.
No se oculta el error ni se modifica una asignacion para evitarlo.

Crear trabajo ahora es el mismo boton circular + de inicio, flotante a la
derecha sobre la barra inferior. La barra conserva Iniciar OT y Entregar OT.
El + abre directamente el formulario del hijo y mantiene el bloqueo offline,
durante operaciones y en fichas cerradas o sin verificacion.

## Instalacion

Publicar los artefactos y referencias de gateway 1.0.26 del backend. Las fuentes
MobileCreation desplegadas con 1.0.53 siguen siendo un requisito, sin cambios
de negocio ni migracion nueva en esta entrega.

Con el backend detenido y drenado, desde su raiz:

```sh
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.26.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Reiniciar una sola instancia fork cuando las comprobaciones sean correctas.
Conservar directorio de sesiones, claves y pendientes. Si npm da ENOTEMPTY,
con el proceso detenido y sin otro npm activo, apartar solo sus temporales:

```sh
respaldo="$(mktemp -d /tmp/qualitzer-gateway.XXXXXX)"
find node_modules/@qualitzer -mindepth 1 -maxdepth 1 -type d -name '.mobile-gateway-*' -exec mv -t "$respaldo" -- {} +
```

Despues repetir instalacion y comprobacion. No eliminar todo node_modules,
package-lock, directorios de sesiones ni colas del telefono.
Instalar la APK como actualizacion, sin borrar datos.

## Verificacion

Regresion inicial reproducida: 404 al consultar la OT con dos bloques horarios.
295 pruebas Mobile/gateway pasan; tipos de app y gateway sin errores. Incluyen
inicio de OT, acceso al hijo, archivos, rechazo de conflictos e identidad ajena
y recuperacion de lectura sin repetir una creacion confirmada.
Seis recorridos RN Web a 360/390/1280 px y texto 100/200%, con 143 comprobaciones
y 12 capturas, verifican el +, inicio/entrega y el formulario con API/OS simulados.
No hay prueba de telefono fisico o escritura remota, ni tests/build/lint/SQL
del backend. La correccion requiere desplegar el gateway en el servidor real.