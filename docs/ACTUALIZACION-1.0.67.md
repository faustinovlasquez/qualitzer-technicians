# Tarjetas y cabecera: APK 1.0.67 / gateway 1.0.31

## Mi jornada

- Cabecera en una fila: logo o nombre de la empresa/sucursal, lupa y punto de conexion. La lupa despliega el buscador; el punto (verde, rojo o ambar) despliega la barra Conectado/Offline con su recargar. Con texto escrito el buscador sigue visible.
- Segunda fila de indicadores: HH asignadas (horas planificadas del periodo o del dia elegido) y HH reportadas (tiempo registrado; un cronometro en curso no cuenta hasta guardarse).
- Barra inferior mas compacta. Si el trabajador tiene foto, se muestra en la pestana Mi perfil.

## Tarjeta de trabajo

Distribucion del panel web: codigos y estado, titulo, descripcion con Leer mas, cliente, equipo, ubicacion, horario y colacion en la misma fila, tecnicos asignados (el propio como Tu), avance total con barra y tiempo restante, y una fila de acciones: Iniciar/Pausar/Reanudar, Entregar, Archivos, Checklist y Comentarios. La logica de cronometro, entrega y modo offline no cambia.

## Tarjeta de OT y mantenimiento

Codigos y estado, tipo, titulo con trabajos y repuestos, cliente, equipo, ubicacion, horario, avance de trabajos y acciones Detalle y Archivos, mas Entregar OT en mantenimientos abiertos. La cabecera del detalle de la orden no cambia.

## Publicacion

Gateway 1.0.31: conserva la colacion de cada trabajo y acepta URLs de logo con espacios en el nombre del archivo. Sin migraciones ni cambios de backend nuevos (el backend ya envia la colacion). En `Qualitzer2.0-Backend/.gitignore` se agrego la excepcion del tgz 1.0.31.

Detener y drenar primero la unica instancia del backend. Desde su raiz:

```bash
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.31.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Iniciar una sola instancia fork. Actualizar la APK sin desinstalar la anterior.

## Verificacion local

1814 pruebas de la app y del gateway pasadas (1 omitida por ser solo POSIX), typecheck sin errores. Tarjetas, cabecera e indicadores verificados en React Native Web en modo demostracion.

Pendiente: prueba en telefono fisico con datos reales, colacion y logos de sucursal tras desplegar el gateway 1.0.31.
