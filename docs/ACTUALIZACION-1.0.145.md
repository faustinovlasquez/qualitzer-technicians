# APK 1.0.145 (versionCode 146) · gateway 1.0.51 (sin cambios)

## Ficha del ingreso más compacta

- Los bloques de acciones (Estado / Mover nave / Fecha, Archivos / Comentarios, avance del ingreso y «Correo al cliente») pasan a **una sola fila** (`src/workshop/entry/EntryToolbar.tsx`):
  - **Avance del ingreso** con porcentaje y barra (verde «Ingreso» si está completo, naranja «Continuar» si falta algo). Abre una ventana con los pasos y «Editar ingreso / Continuar», «Ver inspección» y «Ver firma».
  - **Correo**: ícono con punto de estado (verde enviado, rojo falló, ámbar sin enviar). Abre una ventana con el estado, «Enviar al cliente» y «Ver envíos» (`EntryEmailButton`).
  - **Archivos** y **Chat**: íconos que abren el gestor y los comentarios del ingreso.
  - **Gestión**: ventana con «Cambiar estado», «Mover de nave» y «Fecha de entrega», mostrando el valor actual.
- `IntakeProgress` acepta `fixed` (sin minimizar, dentro de la ventana) y el cálculo del avance queda en `intakeSummary`.

## Foto principal del ingreso

- La foto se elige **sin la pantalla de recorte de Android** (`square: false`, como en la inspección): en varios teléfonos el recorte volvía sin foto y sin aviso, así que no había vista previa ni se guardaba. El cuadrado lo sigue haciendo `squareJpeg`.
- Si Android cerró la app con la cámara abierta, la foto se recupera al volver (`ImagePicker.getPendingResultAsync`).
- Los errores de la foto se muestran junto a la foto, no al final del formulario.

Solo cambia la app; la pasarela sigue en 1.0.51.
