# APK 1.0.149 (versionCode 150) · gateway 1.0.51 (sin cambios)

## Creación de trabajos y órdenes más corta

`src/screens/creation/CreationScreen.tsx`:

- Dos pasos, sin resumen final. Equipo y especialidad salen del primer paso del trabajo; la especialidad se elige en Planificar.
- Botón **Crear e iniciar**: crea el trabajo, lo deja en progreso y arranca el cronómetro al abrir su detalle (`initialAction: "start"`).

## Taller

- Código del ingreso unificado como ING-00047 en toda la app (`src/domain/workshopEntryCode.ts`).
- «Informe de ingreso» pasa a llamarse **Certificado de ingreso**.
- El estado del correo al cliente se actualiza solo tras un envío automático.

## Pasarela

Sigue en 1.0.51. `server/workshop/entry.ts` y `routes.ts` solo usan la función común para el código, con el mismo resultado, así que no hay que actualizarla.
