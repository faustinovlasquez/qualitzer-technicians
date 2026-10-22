# Actualización 1.0.131 — nuevo logo, naves fijadas y clientes desde el ingreso (gateway 1.0.45)

## Qué cambia
- **Logo oficial nuevo**: Q hexagonal con degradado azul y el técnico con casco, sobre fondo claro, centrado y con margen. Cambia el ícono de la app, el ícono adaptativo de Android (fondo `#F1F4F9`), el logo dentro de la app, el favicon y el ícono de notificaciones (silueta blanca; color `#353EE1`).
- **Tablero del Taller**: botón "Ingresar" en cada nave con espacio, nave libre tocable para registrar un ingreso ahí y naves fijadas arriba (se guardan en el teléfono por usuario, sucursal y taller).
- **Ingreso**: sucursales y contactos como campos con etiquetas que se quitan; quitar o cambiar el equipo elegido; botón "+" para crear un cliente, una sucursal o un contacto nuevos con los formularios de la web.

## Despliegue
1. Backend con el paquete `@qualitzer/mobile-gateway` 1.0.45.
2. Instalar la APK 1.0.131 con **Actualizar** (no desinstalar).

## Permisos (los mismos de la web)
- Crear cliente: "crear" en Clientes.
- Crear sucursal: "crear" en Negocios.
- Crear contacto: "editar" en Clientes.

## Destino de esta APK
Compilada desde la rama `desarrollo`: apunta a `https://api-dev-qz-v2.qualitzer.com/api`.
