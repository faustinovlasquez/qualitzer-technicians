# Qualitzer técnicos 1.0.6 — seguridad del teléfono

**COMPILACIÓN DESCARTADA. No instalar.** La prueba nativa detectó un cierre al inicializar la protección de capturas en Android 14+. Se conserva el artefacto para diagnóstico; utilizar [la actualización 1.0.7](ACTUALIZACION-1.0.7.md).

Versión Android 1.0.6, código 7. Misma identidad `com.qualitzer.field`, firma y API remota. Instalar como **Actualizar**, sin desinstalar ni borrar datos.

## Novedad

- Oferta voluntaria después de verificar la sesión: **Vincular y verificar** o **Ahora no**.
- Desbloqueo al abrir o regresar a la app con la huella o credencial de pantalla configurada en el teléfono.
- Activación y desactivación en **Mi perfil → Seguridad del teléfono**, ambas con comprobación nativa.
- Protección de Recientes/capturas, modales y navegación desde notificaciones mientras está bloqueada.
- Se conservan sesión, formularios, archivos y cola offline. No se guarda el PIN, patrón ni biometría.

No requiere desplegar backend ni ejecutar migraciones para esta función. El envío push del servidor sigue siendo un asunto independiente; esta actualización no confirma ni corrige su entrega.

## Prueba en tu teléfono

1. Actualizar la instalación existente y abrir la app con la sesión habitual.
2. Elegir **Vincular y verificar** y completar el diálogo del sistema.
3. Salir a Inicio y volver: debe solicitar desbloqueo. Cancelar debe dejar la app bloqueada sin volver a abrir el diálogo en bucle.
4. Usar **Reintentar desbloqueo** y verificar con huella o credencial del teléfono.
5. Repetir con un formulario y archivos pendientes. Deben conservarse al desbloquear.
6. Para desvincular, entrar a **Mi perfil**, pulsar el botón correspondiente y verificar otra vez.

La seguridad del teléfono no sustituye las credenciales si la sesión de Qualitzer vence o se cierra. Usa un teléfono cuyo código y huellas controles. No borres datos si no puedes desbloquear.

Consulta [alcance, límites y pruebas](SEGURIDAD-TELEFONO.md). La validación con dobles/componentes no sustituye probar el sensor y el PIN en el Samsung físico; iOS requiere compilación y pruebas propias.