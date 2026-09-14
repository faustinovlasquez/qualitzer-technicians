# Validación independiente del reloj de selección de empresa

## Cierre tras reanudar VS Code — 2026-09-10 22:13 UTC

Esta sección sustituye los resultados y bloqueos históricos de abajo para las fuentes actuales.

- **44/44 PASS** en el cierre: 41 de los tres archivos `tests/tenant-challenge-*.test.ts` y 3 regresiones `tests/standalone-session.test.ts`, Node local 22.23.2, cero fallos/omisiones. Añadidos TTL corto sin gracia extra, latencia agotada antes del primer render, nuevo objeto HTTP y cancelación/nuevo intento sin callbacks antiguos.
- **TypeScript app completa + tres tests + helper: 0 diagnósticos**, `noEmit`. No se ejecutó batería global ni TypeScript del servidor en esta continuación.
- **E2E 12/12 PASS**, Edge: 320×568 y 390×844, ±24h, Date expirado, ausente/no expuesto por CORS y avance monotónico de 121 s. Zonas horarias Pacific/Kiritimati/America/Los_Angeles; diez empresas; encabezado visible y volver al acceso alcanzable mediante scroll. Se revisaron capturas a 320 px.
- La fixture usa la app real en Metro propio 8788 y URL standalone `https://tenant-clock.example.com/mobile`, dominio reservado totalmente interceptado. No necesita conexión avanzada ni servidor de autenticación real. Respuestas complete 401 verifican descarte del challenge; DONE sigue cubierto por HTTP/hook, no por navegador.
- Ningún request bloqueado inesperado ni `pageerror` en los doce casos. No cookies/sesión reales, credenciales reales, escrituras externas, reinicio de 8081/8787, APK, backend o modificaciones de branding.
- El panel QR **de desarrollo** puede superponerse parcialmente al contenido en 320 px; no se modificó (fuera de alcance). No se afirma validación nativa de safe area, escalado de fuente o teléfono físico.
- La implementación única es ahora `src/infrastructure/tenantChallengeClock.ts`. HTTP, hook y pantalla comparten esa importación. La ubicación previa `src/domain/tenantChallengeClock.ts` quedó como reexportación de compatibilidad (sin otro WeakMap); la eliminación solicitada al editor no se materializó en disco. El cambio del hook está limitado al import y guard de expiración; branding puede integrar su setter aparte.
- **Pendiente del coordinador de build:** actualizar su captura de procedencia `scripts/android/release-provenance.cjs`, que todavía referencia la antigua ubicación `src/domain/tenantChallengeClock.ts`. Ese script no se editó por restricción de alcance. No compilar usando la ruta vieja.

Evidencia actual:

- `C:/Users/faust/AppData/Local/Temp/qualitzer-tenant-clock-final-PvGxku/summary.json`: testExit 0, diagnostics 0; logs completos adyacentes.
- `C:/Users/faust/AppData/Local/Temp/qualitzer-auth-close-CL9hmj/summary.json`: repetición final 44/44, TypeScript app + tests 0 diagnósticos, diff check 0; sintaxis de ambos scripts E2E 0 y puerto propio 8788 libre.
- `C:/Users/faust/AppData/Local/Temp/qualitzer-tenant-clock-e2e-ebCKZq/summary.json`: 12 resultados PASS, capturas y observaciones Date desde fetch web (respeta CORS).
- `C:/Users/faust/AppData/Local/Temp/qualitzer-tenant-clock-isolated-DUUPpg/summary.json`: smokeExit 0, cierre del Metro propio y SHA256 idénticos antes/después de los cuatro archivos auth de producción. Hashes contrastados nuevamente contra el disco al cerrar.

Runner reproducible: `tests/helpers/tenant-challenge-e2e.cjs`; exige 8788 libre, no carga dotenv, inicia solo la fixture y la limpia al terminar. Dos intentos iniciales fallaron antes de abrir el navegador por flags incompatibles Expo (`--offline` + `--localhost`) y dominio `.test` rechazado por la política standalone; corregidos sin cambiar esa política. La tercera ejecución terminó correctamente.

## Registro histórico anterior (no representa el estado final)

Fecha: 2026-09-10. Node local: 22.23.2. Alcance: cliente móvil, tests de la pasarela móvil y E2E aislado. Sin modificaciones del runtime, backend, frontend ni archivos de la versión 1.0.1.

## Resultado ejecutado

| Validación | Resultado |
| --- | --- |
| `scripts/test.cjs` completo | 753 tests: 752 PASS, 0 FAIL, 1 SKIP |
| TypeScript app, `--noEmit -p tsconfig.json` | EXIT 0 |
| TypeScript pasarela, `--noEmit -p server/tsconfig.json` | EXIT 0 |
| Reejecución independiente de los tres archivos `tenant-challenge-*.test.ts` y `server/tests/login-challenges.test.ts` | 42/42 PASS: 36 cliente + 6 pasarela |
| TypeScript app incluyendo explícitamente los tres tests y `tests/helpers/tenant-challenge.ts` | 0 diagnósticos |
| Sintaxis del nuevo E2E (`node --check`) | EXIT 0 |
| E2E en Metro existente | BLOQUEADO: GET `http://localhost:8081/status` rechazado, ECONNREFUSED |

La única omisión corresponde a permisos POSIX/symlinks en Windows. No hubo fallos de mocks antiguos por ausencia de `performance` o `headers`, ni se modificaron tests existentes. El conteo actual de los tres tests de cliente es **36**, no 39. El runner completo descubre archivos `.test.ts`; no incluye suites `.test.cjs` ni los E2E `.cjs`.

## Revisión del código

- `src/domain/tenantChallengeClock.ts` guarda el anclaje en un `WeakMap` privado por objeto; no agrega propiedades al contrato ni conserva contraseñas/tokens.
- Con Date HTTP canónico, el presupuesto es `min(120000, max(0, expiresAt - serverDate - 1000))`. El deadline se ancla al inicio monotónico de la petición: descuenta todo el viaje de la solicitud, la lectura del body y el tiempo hasta consumir el desafío. Es deliberadamente conservador; puede terminar antes que el servidor, especialmente con solicitudes lentas. No debe presentarse como TTL exacto ni como extensión de la autorización.
- Sin Date utilizable/expuesto, usa como máximo 120 segundos locales monotónicos desde el inicio de la petición; no compara la expiración con el reloj de pared del teléfono. La UI lo etiqueta como vigencia pendiente de validación del servidor.
- Expiración malformada, reloj monotónico no finito o regresivo fallan cerrados. Relecturas, remount y registro repetido del mismo objeto no renuevan el plazo.
- `HttpTechnicianRepository` captura Date y tiempo monotónico inmediatamente tras resolver fetch, antes de leer el body. La pantalla y `useTechnicianApp.selectTenant` consultan el mismo helper; el click revalida y el servidor conserva la última palabra.
- Los tests de pasarela verifican TTL máximo de 120 segundos y mínimo de grants, límite exacto, consumo síncrono irrevocable, elecciones inmutables, aislamiento y capacidad. No se cambió ninguna protección.
- La configuración CORS actual en `server/gateway-runtime.ts` no contiene `exposedHeaders: ["Date"]`. En un navegador cross-origin no se debe asumir que JavaScript ve Date aunque exista en la red. El fallback del cliente cubre este caso sin requerir cambios de servidor. No se comprobó el header de producción ni se hizo login real.

## E2E nuevo, todavía NO validado contra UI

Archivo: `tests/e2e/tenant-selection-clock-smoke.cjs`.

Prepara 12 casos: anchos 320 y 390, cada uno con +24h, -24h, expiración anterior al Date HTTP, Date ausente, Date presente pero no expuesto por CORS y agotamiento del tiempo monotónico. Cada caso crea un contexto nuevo de Edge, bloquea service workers y todas las URLs salvo lecturas de Metro y respuestas interceptadas de la pasarela ficticia en 8788. No abre un listener de fixtures ni reutiliza contexto/sesión reales.

El reloj de pared se sustituye por una subclase de Date anclada al tiempo real inicial y al progreso monotónico; `new Date()` y `Date.now()` coinciden. Los casos normales no alteran `performance.now()`. Solo el caso de agotamiento inyecta un incremento monotónico controlado de 121 segundos.

La pasarela ficticia devuelve varias empresas y un desafío qzc válido sintácticamente. El complete registra solamente el tenant seleccionado y devuelve 401 `INVALID_LOGIN_CHALLENGE`, para comprobar despacho, limpieza del desafío y regreso al acceso con el mensaje correcto. No se implementa ni se afirma un flujo E2E DONE/me/asignaciones; el éxito de sesión está cubierto por los tests VM/HTTP, no por navegador.

El observador de fetch conserva el Response original y registra `response.headers.get("Date")` desde JavaScript web, no desde APIs de Playwright que puedan evitar CORS. Las respuestas normales exponen Date explícitamente; los casos ausente/no expuesto esperan null. Esto sigue pendiente de ejecución real en navegador.

**No hay escenarios UI aprobados, screenshots, Date capturado en UI ni prueba física de teléfono en esta ejecución.** Metro rechazó el GET inicial y no se inició ni reinició ninguna aplicación. El script termina con fallo, sin declarar PASS cuando falta Metro. Tampoco se sustituyó la app por HTML de demostración.

## Evidencia temporal

Directorio de validación:

`C:/Users/faust/AppData/Local/Temp/qualitzer-tenant-clock-validation-P7ytLB/`

- `summary.json`: códigos de salida de batería completa y ambos tsc.
- `full-tests.log`: 753 tests y detalle de la omisión POSIX.
- `app-tsc.log`, `server-tsc.log`: vacíos, ambos EXIT 0.
- `focused-tests.log`: 42/42 PASS.
- `focused-summary.json`, `focused-tsc.log`: salida 0 y cero diagnósticos del grafo app + tests.
- `syntax-summary.json`: versión Node y sintaxis E2E EXIT 0.

Intento E2E:

`C:/Users/faust/AppData/Local/Temp/qualitzer-tenant-clock-e2e-UoysAt/summary.json`

Contiene `results: []`, `physicalPhoneTested: false` y el error de conexión previo al navegador. No contiene credenciales reales ni tokens de sesión.

## Archivos escritos por esta validación

1. `tests/e2e/tenant-selection-clock-smoke.cjs` — nuevo.
2. `docs/TENANT-SELECTION-CLOCK-VALIDATION.md` — este informe.

Sin ediciones a app.json, scripts/android, android, artifacts, runtime cliente/pasarela, tests existentes, backend o frontend. Sin build, lint, Jest/global backend, export, login real, escrituras operativas ni reinicio de servicios.