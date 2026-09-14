# Qualitzer técnicos 1.0.9 — cabeceras compactas

## Cambios visuales

- El bloque «Tu trabajo. En tus manos.» del acceso se convierte en una franja breve con icono, título y una línea descriptiva. Se eliminan el gran espacio decorativo y textos repetidos.
- El formulario de acceso empieza más arriba y conserva sus campos, validación, mostrar contraseña y botón de demostración. No cambia el inicio de sesión.
- «Mi jornada» muestra saludo, tareas restantes, avance, fecha y tiempo planificado en un resumen compacto.
- Pendientes, En curso y Completadas se muestran como tres indicadores bajos en una fila, con número junto al icono. Se conservan las notas útiles de pausa, entregas y cobertura parcial.
- No se recorta el contenido para simular menor altura: el texto ampliado puede ocupar más líneas. Cobertura desconocida sigue apareciendo como «—», no como cero tareas.

En la comparación aislada React Native Web a 390 px de ancho y texto normal, el hero del acceso pasó de 348 a 72 px; cabecera, resumen y KPIs de la jornada pasaron de 520 a 221 px. Los valores exactos cambian con el tamaño y la fuente del teléfono. Se comprobaron también 320/360 px, escritorio y texto al 200 %.

## Actualizar

Versión 1.0.9, código Android 10. Misma firma, paquete y API. Instalar como **Actualizar**, sin desinstalar ni borrar datos.

Esta compactación **no requiere nuevos cambios del backend, gateway ni migraciones**. Conserva la seguridad del teléfono, los avisos y la cola offline. Las funciones de notificaciones añadidas en 1.0.8 mantienen sus requisitos de despliegue anteriores si aún no se han aplicado; no se crea otro paquete de gateway para este ajuste visual.