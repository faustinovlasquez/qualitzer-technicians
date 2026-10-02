# Cabecera con logo y buscador: APK 1.0.71 / gateway 1.0.31

Incluye todo lo de la [actualizacion 1.0.70](ACTUALIZACION-1.0.70.md).

- Cabecera sin el nombre de la sucursal: al inicio, el logo de la empresa/sucursal en un cuadrado; si no hay logo o no carga, sus iniciales.
- El buscador ocupa el espacio que tenia el nombre y esta siempre visible en Mi jornada y Agenda; filtra al escribir y se borra con la X. Reemplaza la lupa.
- A la derecha sigue el punto de conexion, que despliega la barra Conectado/Offline.

El gateway y el backend no cambian respecto de la 1.0.70. Actualizar la APK sin desinstalar la anterior.

## Verificacion local

1816 pruebas de la app y del gateway pasadas (1 omitida por ser solo POSIX), typecheck sin errores. Cabecera verificada a 360 px de ancho en React Native Web, con y sin texto de busqueda.
