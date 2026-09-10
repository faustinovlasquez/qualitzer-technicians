# E2E offline web aislado

## Corrección posterior: archivo raíz directo y actualización en header

- Mobile completo: **703 casos, 702 PASS, 1 skip POSIX/Windows, 0 fallos**; noEmit app/gateway salida 0. Logs: temporal qualitzer-mobile-final-check-nZfXg3.
- Cabecera con actualización trasladada y sin fila «Hoy y pendientes anteriores»: **5/5 PASS**, temporal qualitzer-header-layout-jPKGwj. Agenda: **4/4 PASS**, temporal qualitzer-agenda-layout-rWy1GF.
- Nuevo modo `--direct-group-review`: archivo seleccionado realmente desde OTs → Archivos de la asignación; scope local raíz sin `workId` comprobado y estado legacy de dos intentos sembrado. **No completado**: el selector que expande varios «Ver detalles técnicos» conserva índices cuando los botones cambian de nombre. Tras tres ajustes se detuvo la depuración del test; falta corregir ese selector antes de declararlo PASS. Evidencia final: temporal qualitzer-direct-group-review-BH9cKh.
- Las 50 pruebas nuevas [../../src/offline/tests/direct-document-scope.test.ts](../../src/offline/tests/direct-document-scope.test.ts) sí cubren la corrección motor→cliente HTTP/schemas reales→servidor loopback, incluidos recibos y respuesta perdida sin duplicados.
- La consulta real SELECT-only confirmó el receipt del UUID del usuario como applied/fileId30994; no se usó ese registro como fixture ni se modificó su cola. No demuestra el indicador del teléfono ni S3. No se repitió export en esta etapa.

## Cierre de validación, 10-09-2026

- Batería Mobile: **653 casos, 652 aprobados, 1 omitido Windows, 0 fallos**. TypeScript completo app/gateway sin errores; exportación Android/iOS Hermes y web correcta, en carpeta temporal, sin reemplazar la distribución existente.
- Cabecera: **5/5 PASS**, dos líneas y caso 1 pendiente/1 revisión. Artefactos temporales: qualitzer-header-layout-Vjxrdx.
- Agenda: **4/4 PASS**, 320/360/390/1280 px. Artefactos: qualitzer-agenda-layout-ArmPxk. Se revisaron capturas de día, semana y vacío.
- Offline normal: PASS, artefactos qualitzer-offline-smoke-V4P6XX. Legacy: PASS tras el ajuste final de integridad/URL concurrente, artefactos qualitzer-legacy-review-VUrHbU. Ambos conservan un efecto por tipo y bytes originales tras respuesta perdida y reconexiones.
- Logs finales: carpeta temporal qualitzer-mobile-compact-final-6291f4f9. Los informes anteriores de esta guía son históricos, no fallos vigentes.
- Fixtures propias detenidas; Metro 8081 y gateway habitual 8787 se conservaron. Sin backend/frontend tests/build/lint, SQL, credenciales reales ni modificaciones manuales de colas del usuario. El teléfono no estaba conectado al inspector Expo: no se verificó su archivo concreto.

[offline-smoke.cjs](offline-smoke.cjs) prueba la **app web real** contra [../../scripts/testing/offline-smoke-server.ts](../../scripts/testing/offline-smoke-server.ts), una pasarela ficticia exclusiva de pruebas. No prueba SQL/backend productivo ni usa autenticación real.

## Barreras de seguridad

- La fixture exige **`--isolated-offline-fixture`**; no forma parte del gateway normal ni se debe desplegar.
- Escucha sólo loopback en **8788**, comprueba Host/origen y no reenvía solicitudes a Qualitzer. Datos y recibos ficticios en memoria; reiniciar la fixture los reinicia.
- El test abre un contexto Chromium headless nuevo, sin cookies/perfil del usuario. Permite HTTP sólo a **localhost:8081 y localhost:8788**, además de `blob:`/`data:` locales; bloquea otros orígenes.
- Credenciales ficticias incluidas en la fixture; **nunca introducir credenciales reales ni modificar URLs para apuntar a producción**. No se necesita arrancar backend, gateway normal 8787 ni aplicar migraciones.

## Ejecución manual autorizada

Requisitos: Node 22 del proyecto, dependencias móviles ya instaladas, Playwright disponible y Microsoft Edge instalado. El script busca Playwright en móvil o en el frontend hermano; alternativamente `OFFLINE_SMOKE_PLAYWRIGHT` puede apuntar al módulo instalado. No instala paquetes ni navegadores automáticamente. `OFFLINE_SMOKE_BROWSER_CHANNEL` permite otro canal Chromium instalado; por defecto usa `msedge`.

Desde la raíz de Qualitzer-Mobile, en **terminales separadas**:

1. Servir únicamente el cliente web local (si ya está disponible en 8081, reutilizarlo):

   ```powershell
   .\node_modules\node\bin\node.exe .\node_modules\expo\bin\cli start --web --localhost --port 8081
   ```

2. Arrancar una **fixture nueva** para cada ejecución. El flag es obligatorio:

   ```powershell
   .\node_modules\node\bin\node.exe --import tsx .\scripts\testing\offline-smoke-server.ts --isolated-offline-fixture
   ```

3. Ejecutar el test contra esos servicios locales:

   ```powershell
   .\node_modules\node\bin\node.exe .\tests\e2e\offline-smoke.cjs
   ```

No usar el launcher general para preparar esta prueba ni reemplazar la fixture por el gateway normal. Antes de repetir, detener/reiniciar sólo la fixture de pruebas: el test exige contadores de efectos inicialmente vacíos. Detener los procesos propios con Ctrl+C al terminar; no interrumpir servicios compartidos. Estos comandos están documentados para ejecución explícita: **no se ejecutaron en la tarea documental**.

## Qué comprueba

1. Login ficticio, preparación de siete días y opciones, caída simulada de la pasarela y restauración fría del perfil/cache.
2. Creación offline, PNG local, comentario y respuesta de checklist: cuatro UUID persistidos, sin falsos mensajes de confirmación, sin permisos de ejecución ni avance remoto inventados.
3. **Guardar archivos** persiste bytes en IndexedDB; recargar conserva UUID/estado, texto, base y SHA-256 del blob. La imagen local restaurada abre y decodifica. No cubre persistencia de la selección web previa al botón.
4. Logout con pendientes bloqueado, sin llamada remota de cierre; pausa/entrega no ejecutables offline.
5. Reconexión en primer plano, remapeo del trabajo local al canónico y pérdida inyectada de la respuesta HTTP después de confirmar el archivo en la fixture.
6. Recuperación automática con lectura de recibo y **dos POST de documento con el mismo UUID/payload/bytes**, pero **un solo efecto** de archivo. El `fileId` enlaza la copia local.
7. Dos rondas adicionales de recarga offline/online sin duplicar escrituras ni perder el blob.

## Resultado conocido y alcance

El coordinador ejecutó **PASS**: cuatro operaciones `applied`; efectos **1 creación, 1 comentario, 1 respuesta y 1 archivo**, un blob conservado con hash original, respuesta perdida recuperada, logout bloqueado y sin errores de consola reportados. El script verifica `pageerror`; no sustituye una auditoría completa de logs.

La traza JSON se escribe como **results.json** en un directorio temporal único **qualitzer-offline-smoke-…**, junto a capturas de la cola restaurada y del archivo recuperado. Imprime la ruta al terminar y cierra su navegador; no son capturas de teléfono ni se sobrescriben ejecuciones anteriores.

**No demuestra:** shell web totalmente offline (8081 sigue disponible, no hay PWA), SQLite nativo, cámara/tacto de Android/iPhone, Expo Go sin Metro, push, SQL concurrente ni recuperación del backend real entre efecto y recibo. La pérdida inyectada ocurre **después de guardar el recibo en la fixture**; un efecto backend sin recibo terminal requiere `needs_review`, no replay del efecto.

Validación final complementaria del 09-09-2026: **512 casos, 511 aprobados, 1 omitido por plataforma, 0 fallidos**, TypeScript app/pasarela sin errores y exportación Android/iOS/web correcta. El E2E descrito aquí se cuenta por separado. El servidor ficticio se detuvo al terminar; la aplicación y sus servicios normales no incorporan sus rutas de control.

Guía funcional y recuperación: [../../docs/OFFLINE.md](../../docs/OFFLINE.md).

## Validación de cambios del 09-09-2026

- El selector del centro offline usa ahora el nombre accesible `Conectado a Qualitzer · …`, no la antigua etiqueta `Disponible offline`. Se mantiene la comprobación de conexión verificada antes y después de las reconexiones.
- [checklist-equipment-smoke.cjs](checklist-equipment-smoke.cjs) añade dos contextos Edge headless nuevos a **390 × 844**, uno demo y otro con login ficticio en 8788. Reutiliza Metro 8081 sin detenerlo y bloquea los demás orígenes; no utiliza el gateway normal 8787.
- Asocia un checklist maestro a un trabajo existente, comprueba respuestas iniciales vacías y bloquea repetir la asociación. Los endpoints adicionales de la fixture operan exclusivamente en memoria.
- Busca número interno `1` sin coincidencia por prefijo; busca `15`, exige selección explícita y verifica que consultar `16` no reemplace el ID seleccionado. Conserva el borrador al salir/volver, comprueba el ID 15 en revisión y solicitud persistida, crea y verifica el equipo en detalle. En modo pasarela ficticia vuelve a comprobarlo tras recarga.
- Guarda snapshots de roles de la cabecera y revisión, sin `localhost:3000`, y comprueba ausencia de desbordamiento horizontal. La traza se guarda como **qualitzer-checklist-equipment-smoke-result.json** en el temporal del SO.
- Ejecutar ambos scripts por separado con Node 22 local y una fixture apropiada. `offline-smoke.cjs` exige una fixture sin efectos iniciales; el nuevo smoke admite los efectos de ese flujo y comprueba únicamente los incrementos propios. Reiniciar la fixture antes de repetir el nuevo smoke, porque su trabajo de ejemplo debe empezar sin ese checklist.
- Estas pruebas no certifican dispositivos físicos, persistencia nativa, SQL real ni entrega push. No instalar paquetes ni ejecutar pruebas/build/lint globales del backend para prepararlas.

### Resultado de esta validación

| Comprobación | Resultado |
| --- | --- |
| Batería móvil completa, `scripts/test.cjs` | 588 casos: 587 aprobados, 1 omitido por plataforma, 0 fallidos |
| TypeScript gateway completo | PASS, salida 0 |
| TypeScript app completo | FAIL, salida 2: `ChecklistAssociationPanel.tsx(101,34)`, TS2345, `plainText(option.code)` recibe `string \| null`, pero requiere `string` |
| Offline E2E | PASS: 4 operaciones aplicadas, 1 efecto por tipo, respuesta de documento perdida y recuperada, 2 reconexiones sin duplicados |
| Checklist/equipo E2E | PASS en demo y fixture HTTP, Edge 152.0.4191.66, 390 × 844 |
| Exportación | No ejecutada: pendiente resolver TypeScript con el coordinador |

No se modificó producción para resolver TS2345. El nuevo smoke falló inicialmente porque buscaba el equipo en la pestaña Trabajo; se corrigió solo la navegación del test para abrir Equipo. Ninguna aserción funcional se eliminó. En el smoke preexistente solo se cambiaron los dos selectores de la etiqueta de conexión. Las pruebas bloquearon intentos al gateway normal 8787; no lo utilizaron.

Logs y trazas de esta ejecución: `C:/Users/faust/AppData/Local/Temp/qualitzer-mobile-latest-validation-OWHUAi/`. Contiene `app-ts-final.log`, `server-ts-final.log`, `all-tests-final.log`, `offline-e2e.log` y las trazas `qualitzer-offline-smoke-result.json` y `qualitzer-checklist-equipment-smoke-result.json`. Los snapshots de roles están dentro de la segunda traza.

Ambas instancias propias de la fixture 8788 se detuvieron al finalizar. Metro 8081 y el gateway normal 8787 no se detuvieron ni reiniciaron. No hubo instalaciones, credenciales reales, migraciones, SQL real ni ejecución global de pruebas/lint/build del backend.

## Smoke de cabecera y estado superior

[header-layout-smoke.cjs](header-layout-smoke.cjs) se ejecuta directamente con Node 22 local, reutilizando Metro **8081**. A diferencia de los anteriores, **arranca y detiene su propia fixture 8788** con `--isolated-offline-fixture`; si el puerto está ocupado, falla sin usar ni detener el proceso ajeno. Nunca reinicia Metro ni toca el gateway 8787. Usa Playwright ya instalado (incluido el frontend hermano) y Edge headless, sin instalaciones.

- Contextos nuevos sin perfil, cookies ni almacenamiento del usuario; HTTP/WebSocket restringidos a Metro y fixture. Bloquea otros orígenes y escrituras salvo login ficticio. Cambia `tenant.name` y el nombre de `accessBranchs` a Heavytech SpA sólo en respuestas JSON de la fixture, sin editar su fuente.
- Heavytech a **320, 360, 390 y 1280 px**, más nombre largo a 320: marca única, línea de 30 px, truncamiento, sin FIELD/Entorno local, logout icon-only ≥44×44 con nombre accesible y cancelación sin logout.
- Un solo estado y botón de sincronizar en la parte superior, antes del título y navegación del dashboard; centro offline con regreso, detalles de trabajo/orden, creación y perfil. Espera el cierre animado del modal antes de contar controles.
- Caída exclusiva de fixture: exige «Sin acceso a Qualitzer», no «Sin red» ni conexión confirmada falsa, y comprueba recuperación. No crea trabajos, archivos, respuestas ni comentarios.
- Exige sucursal ausente bajo la cabecera, separación máxima de 4 px y franja ≤50 px. Los dos textos deben medir una línea de 17 px, fuente 12 px y truncamiento de una línea; resumen, sincronizador y logout conservan objetivos ≥44×44.
- Cada escenario añade al final **un comentario sintético `needs_review`**, sólo en el IndexedDB de su contexto nuevo. La app está desmontada durante la escritura; exige cola previa vacía e identidad ficticia. Una revisión cuenta también como pendiente: comprueba «1 pendiente · 1 por revisar», etiqueta accesible completa, centro offline, cancelación de logout y sincronización sin enviar el comentario. No borra ni modifica colas reales.
- Conserva los controles funcionales anteriores. Registra en **accessibility-findings.json** si React Native Web no expone `accessibilityHint` como descripción DOM; eso no acredita accesibilidad nativa ni se presenta como PASS del hint. Si existe descripción web, exige cobertura e instrucciones completas.
- Capturas de ready/retornos y resumen JSON en un directorio temporal único **qualitzer-header-layout-…**, impreso al terminar. Fallos conservan aserciones y capturas; no corrige runtime.

Alcance: presentación web real con anchuras CSS equivalentes al teléfono, no certificación de Samsung físico, motor offline completo ni build nativo. La validación complementaria se limita a TypeScript `noEmit` de app/gateway Mobile y pruebas de presentación offline; no requiere suites, lint ni builds del backend/frontend.

## Recuperación legacy de documento, aislada

### Regresión de archivos en raíz directa

El modo **`--direct-group-review`** de [offline-smoke.cjs](offline-smoke.cjs) requiere la misma fixture nueva y exclusiva en 8788 y reutiliza Metro 8081. No reinicia ni utiliza el gateway habitual 8787.

- Selecciona realmente **OTs → Archivos de la asignación → Galería → Guardar archivos** para el trabajo local; exige que el documento persistido no tenga `scope.workId` ni `stepId`. No transforma sintéticamente el destino de un archivo de trabajo.
- Sólo el error histórico es sintético: con la app desmontada, sin POST de archivo ni recibo previo y dentro del contexto aislado, establece `needs_review`, `OFFLINE_DOCUMENT_UNEXPECTED_ERROR` y **2 intentos**. Scope, UUID, dependencia, reserva y bytes no se cambian. Captura los detalles técnicos y la copia local.
- El padre pendiente no habilita la migración: debe confirmarse primero. Los comentarios/respuestas pueden completarse antes de que otro ciclo recupere el documento. Tras pérdida de respuesta exige el mismo UUID, GET antes de POST, dos POST y un efecto, `workId` numérico en wire y enlace local todavía de raíz.
- Artefactos en **qualitzer-direct-group-review-…**, incluida **direct-group-legacy-two-attempts.png**. Este modo no se considera validado hasta ejecutarlo con el nuevo runtime; no demuestra recuperación de un teléfono real.

La regresión HTTP complementaria está en [../../src/offline/tests/direct-document-scope.test.ts](../../src/offline/tests/direct-document-scope.test.ts). Usa `HttpTechnicianRepository` y schemas reales, servidor loopback con puerto efímero y archivos de bytes en memoria; sólo React Native/photos se adaptan al entorno Node. Incluye normalización, restricciones de migración, identidad de fileList/cache, respuesta perdida, recibo terminal, colisión y ausencia de confirmaciones falsas.

Con el fix del motor/HTTP integrado, ejecutar desde la raíz móvil:

```powershell
.\node_modules\node\bin\node.exe .\node_modules\tsx\dist\cli.mjs --tsconfig server/tsconfig.json --test src/offline/tests/direct-document-scope.test.ts
.\node_modules\node\bin\node.exe .\tests\e2e\offline-smoke.cjs --direct-group-review
```

El segundo comando necesita su propia fixture recién arrancada como se describe arriba. No ejecutar en paralelo con otros smokes que usen 8788.

### Recuperación del error legacy genérico

Ejecutar [offline-smoke.cjs](offline-smoke.cjs) con **`--legacy-document-review`**, Node 22 local y una **fixture recién arrancada**, distinta de la usada para offline normal. El servidor sigue siendo manual: el smoke no arranca, reutiliza ni detiene procesos ajenos. No ejecutar los smokes simultáneamente en 8788.

1. Repite íntegramente el flujo normal: creación offline, PNG de 68 bytes guardado con Galería → Guardar archivos, comentario y respuesta; recarga conserva las cuatro operaciones y la copia local abre.
2. Desmonta la app navegando a una página HTML interceptada en el mismo origen, exclusivamente dentro del contexto propio. Cambia sólo el documento elegido a `needs_review`, `lastError = OFFLINE_SYNC_UNEXPECTED_RESPONSE`, `attempts = 1`, sin recibo. Incrementa revisión y libera la lease de esa fixture desmontada; no cambia UUID, payload, dependencia, nombres, archivo, reserva ni blob. Comprueba exactamente la diferencia y que las otras tres operaciones no cambiaron.
3. Recarga sin acceso a la fixture y vuelve a abrir el PNG local. Reconecta sin pulsar reintentar ni sincronizar: el motor debe recuperar automáticamente el documento legacy.
4. La fixture pierde además la primera respuesta de archivo **después de persistir el recibo en memoria**. Tras otra recarga exige GET de recibo y dos POST con el mismo UUID, un solo efecto, recibo `applied` con `fileId`, SHA-256 y bytes originales, y copia local enlazada.
5. Repite dos reconexiones sin más POST ni efectos duplicados. Conserva las aserciones anteriores de logout bloqueado, permisos offline y ausencia de progreso remoto inventado.

HTTP y WebSocket limitados a localhost:8081/8788, service workers bloqueados; nunca contexto compartido, gateway 8787 ni credenciales reales. Artefactos únicos **qualitzer-legacy-review-…**: **results.json**, cola restaurada, documento recargado offline y archivo recuperado; screenshot de fallo si corresponde.

Esto valida recuperación web/IndexedDB y protocolo contra fixture, **no** multipart Expo nativo, SQLite, S3, SQL ni el archivo pendiente de un teléfono real. Las pruebas unitarias completas Mobile cubren por separado los dobles nativos y las restricciones del motor.

### Resultado de cabecera, 09-09-2026

- TypeScript completo de app y gateway Mobile: **PASS**, ambos con `noEmit`, salida 0.
- Presentación offline (`offline-ui.test.ts` y `offline-dashboard-ui.test.ts`): **22/22 PASS**, sin omitidos.
- Smoke final: **5/5 escenarios PASS**, más comprobación explícita de cero escrituras de negocio/logout, en `C:/Users/faust/AppData/Local/Temp/qualitzer-header-layout-t3VODm/`: 32 PNG y `results.json`. Incluye `360-ready.png`, `320-ready.png`, `1280-dashboard-return.png`, retornos de todas las pantallas y caída/reconexión a 360. La ejecución anterior `qualitzer-header-layout-br6ccr` también pasó los cinco escenarios.
- Incidencia conservada: una ejecución previa, `qualitzer-header-layout-J128gG`, agotó 30 s esperando «Sin acceso a Qualitzer» porque el estado mostraba «No se pudo sincronizar · ver centro». No mostraba conexión exitosa falsa; **no se modificó runtime ni se retiró la aserción**. La ejecución siguiente pasó, pero este caso no se considera libre de intermitencias.
- El primer fallo de conteo ocurrió durante la animación de cierre del centro offline; se corrigió únicamente la espera del test. No se cambió el requisito de un solo estado/sincronizador.