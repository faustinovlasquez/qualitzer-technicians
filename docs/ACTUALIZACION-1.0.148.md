# APK 1.0.148 (versionCode 149) · gateway 1.0.51 (sin cambios)

## Enviar confirmación al cliente, como en la web

`src/workshop/emails/EmailSendScreen.tsx`:

- Orden de la web: **Plantilla, Para, Con copia, Adjuntar informe (PDF), Enviar desde**.
- **Para**: etiquetas «Nombre · correo» (se quitan con la x) y una lista para elegir entre los contactos del ingreso y del cliente con correo. El cliente y sus contactos salen del formulario del ingreso y de la ficha del cliente (`intake.form` / `intake.customer`), sin cambios en la pasarela.
- **«+»**: abre el formulario de contacto nuevo del cliente (`NewContactSheet`, permiso «Crear clientes y contactos»). El contacto queda elegido y, al enviar, se une al ingreso (`saveNewContacts`).
- **Con copia**: correos separados por coma, con los de la configuración de la sucursal precargados y validados antes de enviar.
- **Vista previa** en un botón junto a «Enviar al cliente», que la abre en una ventana.
- Se quitó el campo libre «Agregar otro correo».
- Demostración: el formulario de los ingresos de ejemplo trae su cliente.
