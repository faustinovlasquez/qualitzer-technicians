# Actualizacion 1.0.57: resumen y descripcion del trabajo

Android versionCode 58, misma firma y paquete.

- La ficha muestra la descripcion recibida en work.summary, limitada a tres lineas.
- Al pulsarla abre un dialogo de pantalla completa con titulo y descripcion integra.
- El dialogo incluye fecha programada, horario, tiempo asignado y prioridad.
- El texto completo es seleccionable y desplazable; el cierre permanece fijo.
- Si no existe descripcion se muestra Sin descripcion informada y no se abre un dialogo vacio.
- La tarjeta conserva titulo, fecha, especialidad, cronometro y prioridad; agrega el horario cuando se informa y etiqueta la duracion como Tiempo asignado.

Reutiliza los datos descargados del trabajo, sin consulta adicional ni escritura.
Se conserva el tratamiento de texto plano de la app y la proteccion de privacidad
de los dialogos. No cambia la edicion, los cronometros ni las colas offline.

No requiere nuevo backend ni gateway. El paquete 1.0.27 y el diagnostico pendiente
del error de edicion permanecen independientes de esta mejora visual.
No se modifica la clave Google ni la API definida en el .env privado.
Instalar como actualizacion, sin desinstalar ni borrar datos o sesiones.

## Verificacion

Seis recorridos de descripcion a 360/390/1280 px con texto 100/200% pasan:
131 comprobaciones y 12 capturas. Incluyen texto largo completo hasta el final,
vista previa truncada, cierre fijo, descripcion breve y vacia, HTML como texto
plano y ausencia de escrituras. Otros 12 recorridos de actividades, entrega y
reapertura de la ficha pasan, con 368 comprobaciones. Tipos del grafo probado
sin errores. RN Web con API/OS simulados, no prueba en telefono fisico.
No se ejecutan tests/build/lint/SQL del backend ni despliegue remoto.