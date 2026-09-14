# Qualitzer técnicos 1.0.10 — agenda, filtros y capturas

## Agenda

La carga offline integrada consultaba cada día secuencialmente: siete peticiones lentas podían mantener el indicador durante varios minutos, aunque cada HTTP tuviera su timeout individual. Ahora se consultan como máximo dos días simultáneamente y existe un límite total de 45 segundos, incluyendo la espera de almacenamiento. Un error o timeout no se convierte en una semana vacía ficticia.

Cambiar de período, bloquear la app o cerrar/cambiar sesión cancela lecturas obsoletas. Los refrescos idénticos en curso se comparten. La precarga de la semana espera a que termine la carga visible; las operaciones de trabajo ya enviadas y sus recibos no se cancelan ni se repiten por esta corrección. Un fallo real del servidor aún debe mostrarse como error; las pruebas locales no acreditan el estado del backend desplegado.

## Menos desplazamiento

- Semana, Hoy y flechas en una cabecera breve; tira de días de 52 px con objetivos táctiles de al menos 44 px.
- Eliminado el subtítulo de fecha y «pendientes anteriores» bajo Mis asignaciones.
- Se conservan los avisos necesarios de datos incompletos, días sin copia y trabajos locales. La letra ampliada puede hacer crecer la vista; no se recorta contenido para aparentar compactación.

## Notificaciones

La cola de bandeja es independiente del registro push. Si Expo tarda en obtener su token, se puede seguir consultando la bandeja y cambiar Todas/No leídas. Las lecturas nativas tienen espera acotada; el token dispone de 20 segundos y no se aplica un resultado tardío ni se repite el registro por el timeout.

Con backend/gateway actualizado se mantiene el filtro y conteo global del servidor. Con uno anterior, No leídas filtra los avisos acumulados de las páginas cargadas, permite Cargar más aunque la página visible no tenga no leídas y avisa que no es un resultado global. No se inventa un contador global ni se habilita borrar sin soporte del servidor. «Todas» incluye leídas y no leídas, no significa únicamente «Leídas».

## Capturas

Se permiten capturas con la app **desbloqueada**, manteniendo huella/PIN y la sesión. Al bloquear, el contenido y los modales se ocultan; la protección de captura se vuelve a solicitar. No se cambian las preferencias guardadas ni se obliga a desvincular la seguridad del teléfono.

## Instalación

APK 1.0.10, código 11. Misma firma, paquete y API. Instalar como **Actualizar**, sin desinstalar ni borrar datos.

No hay cambios adicionales de backend, gateway ni migraciones en esta versión. El borrado persistente y conteo global de avisos mantienen los requisitos de servidor/gateway 1.0.2 de la actualización anterior, si todavía no se desplegaron.

## Comprobar después de actualizar

1. Abrir Agenda y cambiar entre semanas; debe terminar la carga o mostrar un error concreto, no quedar esperando indefinidamente.
2. Revisar el selector compacto y que no esté el subtítulo eliminado.
3. Alternar Todas/No leídas; si aparece el aviso de filtro sobre elementos cargados, usar Cargar más o completar el despliegue pendiente del servidor.
4. Desbloquear con huella/PIN y realizar una captura. Salir y volver debe seguir solicitando la verificación sin perder borradores.

Las pruebas automatizadas usan datos y puertos simulados. Las respuestas reales de Agenda y la experiencia del Samsung físico requieren verificación en ese entorno; no se ingresaron credenciales ni se hicieron escrituras en la API real para estas pruebas.