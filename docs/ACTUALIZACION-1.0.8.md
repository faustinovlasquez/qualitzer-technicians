# Qualitzer técnicos 1.0.8 — notificaciones

## En la app

- **Avisos** es la bandeja de la cuenta/sucursal: todas/no leídas, tarjetas diferenciadas, fechas y referencia del trabajo. Los detalles técnicos se despliegan cuando se necesitan.
- El badge de Avisos usa el número global de no leídas enviado por el servidor, no el número de una página. Se actualiza al consultar, recibir, leer y eliminar.
- Cada aviso permite marcar lectura o eliminar con confirmación. Eliminar quita el aviso de tu bandeja, no el trabajo; requiere conexión y confirmación del servidor.
- **Mi perfil → Configurar notificaciones** reúne permisos, avisos de asignaciones, cronómetros, horario silencioso, prueba y diagnóstico. Los cambios se guardan explícitamente y se conservan al bloquear el teléfono.

## En el teléfono

- Icono Q monocromo propio para la barra de Android, títulos diferenciados y texto breve sin nombres de clientes/equipos.
- Reintentos del mismo evento utilizan el mismo identificador de presentación. La app evita presentar dos veces el mismo evento en primer plano y no crea una segunda notificación local para un push recibido.
- El doble toque en el botón de prueba comparte una solicitud mientras está en curso. Una prueba registrada no invita a reenviar si falla solo el refresco de la bandeja.
- La cabecera de una OT no genera un aviso adicional si un trabajo hijo cambiado de esa misma OT/fecha se notifica en el mismo ciclo.

No existe garantía absoluta de entrega exactamente una vez entre servidor, Expo y Android/iOS. Si persisten repeticiones, los detalles muestran el identificador para distinguir un reintento del mismo evento de dos eventos distintos. No se alteran las asignaciones históricas ni se borran filas para ocultar duplicados.

Android conserva los ajustes de un canal que ya existe. Revisar sonido, vibración y ventanas emergentes desde **Ajustes del teléfono** en la configuración de avisos. No se fuerza ni recrea un canal para saltar la elección del usuario. El badge del icono del sistema depende del launcher y de los permisos; no se garantiza actualización exacta mientras la app está cerrada.

## Instalación y servidor

Instalar como **Actualizar** sobre 1.0.7, mismo paquete/firma/API, sin borrar datos. Se conserva el bloqueo del teléfono, el checklist y la cola offline.

Para filtros, eliminación y contador global se requiere backend actualizado, la migración incremental de `hiddenAt` y gateway **1.0.2**. El paquete está preparado en [artifacts/mobile-gateway/qualitzer-mobile-gateway-1.0.2.tgz](../artifacts/mobile-gateway/qualitzer-mobile-gateway-1.0.2.tgz), SHA-256 `7875d88a0a80f696edabdec81130ec29adf90d5d592067f7a391c63a2a21d677`.

El backend incluye su guía de despliegue de notificaciones. No se ejecutaron migraciones ni despliegue remoto. Con servicios antiguos, la app conserva la lectura básica y muestra que las funciones nuevas necesitan actualización; no inventa conteos ni oculta avisos solo localmente como si se hubieran eliminado del servidor.

La validación automática y visual utiliza cuentas/puertos simulados. El envío real, la eliminación SQL y la experiencia en el Samsung físico requieren la prueba controlada después del despliegue.