# Cambio de sucursal desde el logo: APK 1.0.79 / gateway 1.0.33

Mantiene todo lo de la [actualizacion 1.0.78](ACTUALIZACION-1.0.78.md) y agrega:

- **Selector de sucursal en el logo del encabezado.** Al tocar el logo se abre un dialogo con la sucursal activa (logo y nombre). Si el usuario tiene acceso a mas de una sucursal habilitada, se listan y se puede cambiar con un toque; el logo muestra un pequeno icono de intercambio cuando hay otras disponibles.
- Al cambiar se muestra el mensaje "Ahora trabajas en <sucursal>" y el dialogo se cierra.
- El cambio sigue las mismas reglas de seguridad de Mi perfil: requiere conexion, sincroniza antes y no cambia si quedan pendientes sin confirmar (se explica en el dialogo). Los errores (por ejemplo, sucursal deshabilitada) se muestran en el mismo dialogo.
- Corrige las iniciales del logo cuando la empresa no tiene imagen.

Actualizar la APK sin desinstalar la anterior; la cola local se conserva.

## Verificacion local

1832 pruebas de la app y del gateway pasadas, typecheck sin errores.
