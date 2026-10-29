# APK 1.0.146 (versionCode 147) · gateway 1.0.51 (sin cambios)

## Foto principal del ingreso (segundo arreglo)

En la 1.0.145 la foto quedaba «lista» pero la vista previa salía gris (sin el ícono de la cámara) y no se veía guardada.

- La vista previa ya no usa la foto original de la cámara (50 MP o más en teléfonos actuales, que Android no alcanza a dibujar en el recuadro) sino el **JPEG reducido a 1280 px guardado en un archivo** (`scaledJpegWithPreview` en `src/infrastructure/avatarImage.ts`), con `resizeMethod="resize"`.
- La foto se procesa **igual que las de la inspección** (reducir sin recortar), que funcionan en el mismo teléfono; el tablero y la ficha la muestran en cuadrado.
- Si aun así la vista previa no se puede dibujar, se avisa junto a la foto con el detalle del error (la foto se envía igual).

Solo cambia la app; la pasarela sigue en 1.0.51.
