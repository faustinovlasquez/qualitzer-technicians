# Tocar una notificación abre su destino: APK 1.0.110

Mantiene todo lo de la [actualizacion 1.0.109](ACTUALIZACION-1.0.109.md) y corrige:

- **Al tocar una notificación con la app en segundo plano, la app abre su destino** (OT, trabajo o Materiales). Antes Android entregaba el toque un instante antes de que la app volviera al frente; la app lo guardaba "para después" y nunca lo abría, dejando la pantalla anterior (por ejemplo Ajustes).
- Ahora el toque guardado se reintenta durante unos segundos hasta que la app está lista.

## Verificacion local

1871 pruebas de la app y del gateway pasadas, typecheck sin errores.
