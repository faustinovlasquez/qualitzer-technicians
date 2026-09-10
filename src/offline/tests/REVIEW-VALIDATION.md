# Revisión offline — referencia para el coordinador

Fecha de la tarea: 2026-09-08. Runtime: Node v22.23.2.

## Resultado ejecutado

```text
Node: v22.23.2 ; offline dependency graph diagnostics: 0
ℹ tests 93
ℹ suites 0
ℹ pass 93
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1032.4581
```

Comando desde la raíz móvil:

```text
node node_modules/tsx/dist/cli.mjs --tsconfig server/tsconfig.json --test --test-reporter=spec src/offline/tests/engine.test.ts src/offline/tests/repository.test.ts
```

Typecheck aislado mediante TypeScript API `createProgram`, opciones del tsconfig móvil y `noEmit:true`. Raíces: domain/offline, offline/engine, state, contracts, cacheSchemas, OfflineTechnicianRepository y las tres fuentes de pruebas. Se comprobaron todos los diagnósticos de ese grafo, no sólo archivos editados: cero. No se ejecutaron build/lint ni pruebas de backend/gateway/UI, ni instalación de paquetes.

## Regresiones nuevas verificadas

- Respuestas de texto, número, validation true/false/null/not_applicable, select, approval y multiselect: UI intacta y wire canónico durable; contrato de envío validado con syncCommandSchema.
- Migración v1 con tipo cacheado, preservación del base anterior aunque cambie el servidor, canonical legacy y tipo desconocido retenido en needs_review sin borrar datos.
- GET/POST in_progress: pending y mínimo 5000 ms durable, sin bypass por retry/reinicio.
- GET applied de hash ajeno: POST obligatorio antes de confirmar; colisión HTTP409 o recibo queda needs_review permanente. GET conflict/needs_review/rejected jamás fuerza POST.
- Replays tras respuesta perdida: UUID/payload de comentarios y respuestas iguales; metadata y referencia al archivo propio iguales. Cambios posteriores de caché no alteran wire.
- Preparación con catálogo combinado y específicos, comentarios página 0 y scope diario para grupos; lectura por identidad del recurso entre diferentes fechas; migración de claves legacy.
- Semana parcial conserva días conocidos y creaciones locales, sin inventar cobertura. Separación de sucursal/grupo/trabajo/paso y comprobación de identidad/metadatos/JSON corrupto.
- Recibo fileId enlaza archivo canónico, sustituye URL por copia offline y persiste binding. Legacy aplicado sin fileId conserva bytes pero no duplica ni enlaza por nombre.
- 403 conocido impide fallback posterior y lectura local vinculada hasta reautorización remota. Nunca elimina bytes.
- Arranque con snapshot offline y recuperación tras fallo protegido reintentan me usando conectividad actual.
- Se mantienen pruebas originales de cuotas 25/500 MiB, sin expulsión; commit-before-network, CAS, lease, ownership y aislamiento.

## Integración pendiente del padre

1. Mostrar aviso cuando `snapshot.missingDates` no esté vacío. `coverage` sólo acredita días consultados; una creación local no implica cobertura remota de ese día.
2. Las nuevas `operation.answer/base` siguen siendo UI; `operation.wire` es privado para envío. No convertir el wire en respuesta confirmada de checklist.
3. Si se desea exponer una copia legacy aplicada sin `receipt.fileId`, usar una sección separada «copia local sincronizada», operación persistida y `readLocalFile(operation.file.id)`. Nunca enlazar por nombre ni volver a subir con UUID nuevo automáticamente.
4. Limpieza de archivos/quota queda explícita y futura. Estas correcciones no eliminan confirmados ni pendientes.
5. NetInfo ya consultaba `current()` y reintentaba `me` independientemente del alias visual `online`; quedó cubierto con regresiones, sin cambiar su adaptación nativa.

Alcance de escritura: únicamente src/offline y src/domain/offline.ts. Sin cambios a offlineProtocol, UI/hooks/App, gateway, dependencias, backend ni frontend. Los esquemas de caché son locales y no importan server/contracts.

No se afirma prueba física de bytes SQLite/IndexedDB, dispositivo, navegador real ni reenvío real al backend: los tests usan puertos y almacenamiento en memoria.