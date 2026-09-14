# Qualitzer técnicos 1.0.1

## Instalación

Usar [el APK firmado](../artifacts/qualitzer-tecnicos-1.0.1-android.apk) e instalar encima de Qualitzer Field, eligiendo **Actualizar**. No desinstalar ni borrar almacenamiento. El paquete sigue siendo `com.qualitzer.field` y el certificado es el mismo de 1.0.0.

- Versión: 1.0.1; versionCode: 2.
- Tamaño: 49.334.580 bytes, aproximadamente 47,05 MiB.
- SHA-256: `e91aaecf46d8c37a9431f83de141872b046aa15545c68c86becf806a81965f48`.
- Android 7 o posterior, ARM64 y ARMv7. Release no depurable, Hermes y assets incorporados, alineación de 16 KiB.
- URL fija: https://api-demos-qz-v2.qualitzer.com/mobile. Health comprobado con HTTP 200, `ok: true`, `backendReachable: true`.
- La conexión no requiere Expo Go, Metro ni el computador. La página de descarga local sí requiere la misma Wi-Fi durante la descarga.

## Corrección del acceso

La selección de empresa deja de comparar el vencimiento del servidor directamente con el reloj civil del teléfono. Usa un presupuesto monotónico anclado al inicio de la petición y al `Date` del servidor cuando está disponible, descontando latencia y tiempo de lectura. Sin un `Date` utilizable, no bloquea inmediatamente por el desfase: deja al servidor validar la elección dentro de una ventana local acotada.

No se prolongan grants en el servidor, no se reenvían contraseñas ni se guarda un challenge en el disco. Un rechazo real del servidor continúa deteniendo la selección. Ver [TENANT-SELECTION-CLOCK-VALIDATION.md](TENANT-SELECTION-CLOCK-VALIDATION.md).

## Identidad visual

- Nombre base: **Qualitzer técnicos**.
- Icono inicial y marca del acceso: Q original del frontend, sin redibujar.
- Tras login: nombre/logo de la empresa configurados por el sistema.
- En **Mi perfil → Añadir empresa a pantalla de inicio**, se puede solicitar un acceso con su marca. Android pide confirmación; no se cambia automáticamente el nombre/icono principal del cajón de aplicaciones. La tarjeta Recientes puede mostrar la empresa según Android/lanzador.
- Logos empresariales PNG/JPEG/WebP base64 válidos se usan en ese acceso; logos ausentes o no compatibles usan Qualitzer y se informa en el perfil. Grupoeliseo no devolvía logo en la consulta pública de esta entrega; Heavytech sí.

## Evidencia y límites

Suite Mobile: **773 pruebas, 772 aprobadas, 1 omitida por plataforma y 0 fallos**; tipos de app/pasarela sin errores. Pruebas adicionales de assets: 4/4; reloj: 12 escenarios UI aislados; branding y header/perfil: cuatro anchos verificados por cada smoke. No equivalen a pruebas físicas.

Compilación release final: salida 0, 145 segundos. Firma APK v2 cotejada con el certificado anterior; APK 1.0.0 conservado intacto. Se verificó que el bundle contiene las fuentes finales del reloj, HTTP, hook, selector y branding; el DEX contiene el módulo empresarial. Los 15 iconos nativos coinciden con los recursos generados. No se añadieron permisos.

La optimización de Android renombra recursos dentro del APK. La auditoría consulta la tabla real de recursos, no supone nombres de archivo sin optimizar.

Informes: [verificación del APK](../artifacts/release-verification-1.0.1.json) y [auditoría final](../artifacts/final-audit-1.0.1.json). La instalación física, el login nativo y la confirmación del acceso empresarial deben comprobarse en el teléfono. No se cambiaron ni desplegaron archivos del backend/frontend en esta entrega.