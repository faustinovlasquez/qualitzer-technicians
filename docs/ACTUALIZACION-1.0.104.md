# Inicio y entrega del mantenimiento guiados: APK 1.0.104

Mantiene todo lo de la [actualizacion 1.0.103](ACTUALIZACION-1.0.103.md) y agrega:

- **Al iniciar el primer trabajo de un mantenimiento pendiente** la app avisa que también se inició el mantenimiento (el servidor ya lo pasaba a en curso).
- **Al entregar el último trabajo** se abre sola la ventana "Entrega de mantenimiento" con el aviso de que los trabajos quedaron listos y falta cerrar el mantenimiento.
- **Ventana en tarjetas:** nota técnica, tipo de falla (obligatorio con gateway 1.0.39) y firma del técnico. Sin receptor ni duración visibles; la duración se envía sola desde los cronómetros.

Requiere backend y gateway 1.0.39 para guardar el tipo de falla; con un servidor anterior la entrega funciona sin pedirlo.

## Verificacion local

1868 pruebas de la app y del gateway pasadas (1 omitida), typecheck sin errores.
