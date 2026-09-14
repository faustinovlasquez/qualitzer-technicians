# Qualitzer técnicos 1.0.7 — seguridad del teléfono

Android versión 1.0.7, código 8, paquete `com.qualitzer.field`. Misma firma y API que la 1.0.5 instalada. La compilación intermedia 1.0.6 fue descartada en pruebas nativas y no se recomienda instalarla.

## Activar

1. Instalar como **Actualizar**, sin desinstalar ni borrar datos.
2. Ingresar normalmente o recuperar la sesión existente. Después de verificarla, elegir **Vincular y verificar**.
3. Confirmar con la huella o credencial del sistema. **Ahora no** conserva el acceso habitual; puede activarse después desde **Mi perfil → Seguridad del teléfono**.
4. Al abrir o volver de segundo plano, desbloquear para continuar. Cancelar mantiene el bloqueo y permite reintentar manualmente, sin bucles.
5. Desactivar desde el perfil también requiere verificar la identidad con el teléfono.

La función conserva formularios, archivos pendientes, sesión y cola offline. Protege Recientes, capturas y modales, y difiere la apertura de trabajos desde notificaciones hasta desbloquear. No almacena huellas, rostros, PIN ni patrones.

La biblioteca de protección requiere el permiso normal `DETECT_SCREEN_CAPTURE` en Android 14+ incluso durante su inicialización. Esta versión lo conserva para evitar el cierre observado en 1.0.6, sin solicitar acceso global a fotos. No hay envío ni almacenamiento de eventos de capturas por la app.

**No requiere cambios del backend ni migraciones.** No reemplaza las credenciales al cerrar sesión o si el servidor la revoca, y no corrige ni acredita el despacho de notificaciones push investigado por separado.

## Comprobación en el teléfono físico

- Probar huella y alternativa PIN/patrón, cancelar y reintentar.
- Salir a Inicio, bloquear el teléfono y volver. Comprobar que no aparecen datos antes de verificar.
- Repetir con un formulario y archivos pendientes: deben conservarse al desbloquear.
- Comprobar un aviso: su trabajo solo se consulta después de desbloquear y validar la sesión.
- Desactivar desde el perfil con verificación.

Consultar [alcance y límites](SEGURIDAD-TELEFONO.md). Los tests con sensores simulados no verifican el Samsung físico ni Face ID; iOS requiere su compilación y pruebas propias.