# Selección de empresa: reloj del cliente

La comparación anterior entre `expiresAt` del servidor y `Date.now()` del teléfono podía rechazar inmediatamente una selección válida. El defecto se reproduce con relojes simulados; no se ha verificado el desfase del teléfono del usuario.

El cliente es compatible con la pasarela pública 1.0.0 sin modificar su contrato. El servidor conserva la autoridad exclusiva sobre los grants de 120 segundos y un solo uso.

## Cálculo compartido

- La implementación única está en `src/infrastructure/tenantChallengeClock.ts`; HTTP, hook y pantalla importan el mismo módulo y comparten el mismo `WeakMap`.
- `tenantChallengeMonotonicNow()` lee `globalThis.performance.now()` (Expo 57 / React Native 0.86). No usa la hora absoluta del teléfono.
- `registerTenantChallengeClock(challenge, timing?, clock?)` registra una sola ancla en un `WeakMap` por objeto. HTTP captura el inicio de petición y la llegada de encabezados antes de leer el cuerpo; registra el objeto después de validarlo. Una segunda llamada no renueva el plazo.
- Con `Date` HTTP válido, el presupuesto es `min(120000, max(0, expiresAt - Date - 1000))` milisegundos desde el inicio monotónico de la petición. Se descuenta conservadoramente todo el trayecto hasta encabezados, la descarga/lectura del cuerpo y el tiempo posterior. El segundo adicional contempla la precisión del encabezado.
- Sin `Date` válido o accesible por CORS, el presupuesto local máximo es 120000 ms desde el inicio original; no se compara con la hora del teléfono. Un objeto legacy no registrado se ancla en su primera lectura. La UI indica que el servidor validará la vigencia: no garantiza 120 segundos de TTL real restante.
- `getTenantChallengeRemaining(challenge)` devuelve `{ remainingMs, source }`, con `source` igual a `server`, `unverified` o `invalid`. Devuelve exactamente cero al agotarse el presupuesto; un `expiresAt` malformado o un reloj monotónico inválido/regresivo falla cerrado. La pantalla y el hook consultan esta misma función.

Re-renderizar, volver a la pantalla con el mismo objeto o reanudar `AppState` recalcula el tiempo transcurrido sin renovar el ancla. No se persisten ni serializan metadatos de reloj, contraseñas o nuevos tokens. No hay refresco automático, repetición de credenciales ni reutilización de la selección tras un fallo. Un 401 de `/complete` limpia el flujo de selección y conserva la cola/almacenamiento existente. El reloj del desafío no cierra sesiones establecidas.

La acción **Volver al acceso** está antes del selector; al vencer o fallar el reloj se ocultan las tarjetas y se muestra una razón explícita. El bloqueo de autenticación pendiente se mantiene.

## Validación local

Pruebas puras y VM de las implementaciones reales de HTTP, hook y pantalla cubren desfases de horas, saltos del reloj, latencia de petición/cuerpo, Date ausente/malformado, expiración inválida/real, reanudación/remontaje, locks/cancelación, rechazo 401 y ausencia de metadatos en JSON. Transporte y almacenamiento son dobles aislados: no se envían credenciales reales ni se tocan colas reales.

Resultado final del 10 de septiembre de 2026: 41/41 pruebas de challenge aprobadas, cero diagnósticos TypeScript en toda la aplicación con las nuevas pruebas incluidas explícitamente, y `git diff --check` sin errores. Incluye TTL de 1–5000 ms, precisión Date de un segundo, respuesta tardía sin presupuesto extra y nuevo intento después de cancelar sin reutilizar anclas/callbacks.

E2E real de la app web: 12/12 escenarios en Edge aislado, 320×568 y 390×844, desfases ±24 horas y zonas Pacific/Kiritimati y America/Los_Angeles. Destino standalone ficticio HTTPS con todas las respuestas interceptadas; sin credenciales/cookies reales ni escrituras externas. Ver `TENANT-SELECTION-CLOCK-VALIDATION.md` para evidencia y límites.

No se ha generado un APK ni validado físicamente el comportamiento en Android/iOS. No se modificaron pasarela, backend, tarball ni configuración del APK. Se inició y cerró solamente Metro propio de la fixture en 8788; 8081/8787 no se iniciaron ni detuvieron. El fix está en fuentes, no se afirma que esté en el APK instalado.