# Tarjeta recordada, repuestos internos ocultos y carga de avisos: APK 1.0.120

Mantiene todo lo de la [actualizacion 1.0.119](ACTUALIZACION-1.0.119.md) y cambia:

- **La tarjeta de detalle de OT, mantenimiento y trabajo ya no se cierra sola al hacer scroll** ni se anima: el técnico la minimiza o expande con la flecha y la decisión se recuerda al salir y volver a entrar (también tras cerrar la app).
- **Se oculta el trabajo interno "Productos (supervisor)" / "Productos utilizados"** que crea la web para guardar repuestos, igual que en la vista técnico web. Los repuestos siguen en la pestaña Repuestos.
- **Al tocar un aviso se muestra "Abriendo aviso…"** con un indicador de carga hasta llegar al destino.

## Verificacion local

1882 pruebas de la app y del gateway pasadas, typecheck sin errores. Gateway sin cambios (1.0.41).
