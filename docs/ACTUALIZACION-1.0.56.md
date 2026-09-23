# Actualizacion 1.0.56: acciones de OT compactas

Android versionCode 57, misma firma y paquete.

- Iniciar OT y Entregar OT muestran icono y texto en una fila horizontal.
- Altura minima de 44 px, con menos relleno; el texto ampliado puede crecer sin recortarse.
- La presentacion offline conserva el mismo formato compacto y sus bloqueos.
- Actualizar estado de OT desaparece del footer incluso cuando hay error.
- Se conservan el + flotante, la actualizacion de cabecera y los dialogos y validaciones de inicio y entrega.

No cambia el backend, frontend ni gateway 1.0.26. No se ocultan los errores de
asignacion: su correccion de 1.0.55 sigue requiriendo instalar gateway 1.0.26
en el servidor. Esta entrega no cambia autorizaciones ni operaciones de negocio.

Instalar como actualizacion, sin desinstalar ni borrar datos, sesiones o colas.
Se conservan la clave Google Android, la configuracion de API y los permisos.

Seis recorridos RN Web a 360/390/1280 px con texto 100/200% pasan: 167
comprobaciones y 18 capturas. Verifican altura compacta, textos visibles,
dialogos, creacion y ausencia del boton de actualizar al fallar la consulta.
API y sistema operativo simulados; no prueba en telefono fisico ni despliegue
remoto. Sin tests, build, lint o SQL del backend.