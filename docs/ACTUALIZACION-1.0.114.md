# Permisos como paso de seguridad: APK 1.0.114

Mantiene todo lo de la [actualizacion 1.0.113](ACTUALIZACION-1.0.113.md) y agrega:

- **Cada vez que se entra a la app** (abrirla, iniciar sesión o volver a ella, como máximo cada 5 minutos) se revisan notificaciones, cámara y ubicación. Lo que falte se pide con la ventana del teléfono.
- **Permisos bloqueados** (el teléfono ya no deja preguntar): un solo aviso con la lista y el botón Abrir ajustes. Al volver desde Ajustes se revisa de inmediato.

## Verificacion local

1880 pruebas de la app y del gateway pasadas, typecheck sin errores. Gateway sin cambios (1.0.41).
