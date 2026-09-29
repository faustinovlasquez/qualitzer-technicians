# Qualitzer tecnicos 1.0.64

## Cambio

- Fondo azul de borde a borde en el icono instalado, sin el recuadro blanco exterior.
- Q y llave aproximadamente un 60 % mas grandes, conservando el espacio seguro para las mascaras Android.
- Se conserva el circulo blanco que pertenece al dibujo de la llave, no el margen exterior de la imagen.
- Mismo PNG original, paquete `com.qualitzer.field`, firma, servidor, permisos, sesiones y datos offline.
- Codigo Android 65. Este cambio no requiere actualizar backend, frontend web ni gateway.

## Instalacion

1. Conectar telefono y computador a la misma Wi-Fi para descargar.
2. Escanear el nuevo QR y descargar el APK 1.0.64.
3. Elegir **Actualizar**. No desinstalar ni borrar datos o pendientes.

El icono instalado solo cambia al actualizar el APK. Recargar la app no reemplaza los recursos del escritorio. El computador solo es necesario para la descarga local.

## Verificacion

Cinco pruebas de marca pasan: fuente aprobada intacta, regeneracion exacta, bordes opacos azules, conservacion del dibujo y zona segura. Las cinco densidades nativas generadas tambien tienen bordes opacos azules. La comparacion de mascaras redonda y redondeada es una simulacion local; no se ha probado esta version en un telefono fisico.

Compilacion firmada y auditoria completadas el 2026-09-29: 15 iconos nativos empaquetados verificados, misma firma, ningun permiso adicional y APK 1.0.63 intacto.

- APK: [../artifacts/qualitzer-tecnicos-1.0.64-android.apk](../artifacts/qualitzer-tecnicos-1.0.64-android.apk).
- Tamano: 73998365 bytes.
- SHA-256: `60f8d14ca7b17ee29cc3adec0b35f734ba53af1769ec0410b204750a9da05f6c`.
- Auditoria: [../artifacts/final-audit-1.0.64.json](../artifacts/final-audit-1.0.64.json).