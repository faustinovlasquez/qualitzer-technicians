# APK 1.0.144 (versionCode 145) · gateway 1.0.51

## Correo de confirmación de ingreso al cliente (como en la web)

- **Al terminar la recepción** aparece «¡Ingreso realizado!» (la misma animación de las OT enviadas) con el estado del correo:
  - Automático: «Enviando la confirmación al cliente…» y luego a quién y por qué canal salió (consulta el historial cada 2 s, hasta 30 s).
  - Manual (o sin contactos con correo): «Enviar confirmación» o «Enviar después».
- **Enviar confirmación** (`src/workshop/emails/EmailSendScreen.tsx`):
  - Plantilla preseleccionada.
  - Contactos del ingreso con correo y correos nuevos, que se pueden guardar como contacto del cliente y del ingreso.
  - «Enviar desde»: automático o un canal conectado, con su estado y qué falta para conectarlo.
  - Adjuntar informe y vista previa en texto.
- **Ficha del ingreso** (con la recepción firmada): bloque «Correo al cliente» con estado («Enviado a N · leído por M»), «Enviar al cliente» / «Reenviar» y «Envíos». Los envíos muestran fecha, canal, quién envió, lectura y, si un canal falló, la explicación en simple.

Gateway 1.0.51 (`server/workshop/customerEmails.ts`): elegibilidad, opciones (plantillas y canales), vista previa en párrafos, envío (permiso `workshopReception`) e historial. Requiere el backend con el módulo `customerEmails` y sus migraciones del 20261029.
