# APK 1.0.147 (versionCode 148) · gateway 1.0.51 (sin cambios)

## Foto principal del ingreso (tercer arreglo)

En la 1.0.146 la vista previa seguía sin verse (cámara y galería) y no aparecía la pantalla de recorte.

- **Vuelve la pantalla de recorte cuadrado** del sistema al elegir la foto (`pickAvatar` sin `square: false`).
- La vista previa **se vuelve a montar** 400 ms después de volver de la cámara o la galería (`previewKey` en el recuadro y `key` en la imagen): mientras el selector está abierto la protección del teléfono oculta la pantalla y Android no dibujaba lo montado en ese momento.
- Se mantiene la vista previa desde el JPEG reducido en archivo (`scaledJpegWithPreview`) y el aviso con detalle si no se puede dibujar.
- Probado en el emulador Android 16 (x86_64): galería y cámara muestran el recorte y luego la vista previa. Esta APK incluye además `x86_64` para poder probarla en el emulador.

Solo cambia la app; la pasarela sigue en 1.0.51.
