# Cliente de notificaciones móviles — integración del padre

Implementación aislada: solo este directorio, `src/screens/notifications/` y `tests/notification-client.test.ts`. No integra App, hooks existentes, perfil, navegación, paquetes ni configuración. Reutiliza los esquemas de `src/domain/notifications.ts`; no hay contratos internos duplicados.

## Versiones y requisitos

- Leídas las instrucciones AGENTS y la documentación exacta: https://docs.expo.dev/versions/v57.0.0/sdk/notifications/.
- El manifiesto de módulos del Expo instalado (`~57.0.20`) indica **expo-notifications ~57.0.17** y **expo-crypto ~57.0.2**. Instalación a cargo del padre; no se ejecutaron comandos de paquetes.
- AsyncStorage ya existe. Persiste únicamente UUID opaco de instalación y consentimiento booleano por namespace. Token Expo y token nativo se mantienen solo en memoria; no se registran en logs ni se persisten en este cliente.
- El padre configura plugin `expo-notifications`, canal predeterminado `technical-work`, FCM/APNs y EAS. Se necesita nueva compilación nativa con esas dependencias/credenciales. No necesita tarea en segundo plano, alarmas exactas ni permisos de background remoto.
- EAS projectId real de `Constants.easConfig.projectId`, con fallback a `Constants.expoConfig.extra.eas.projectId`; se exige UUID y coherencia si ambos existen, y coincidencia exacta con `/status`. No hay valor de ejemplo predeterminado.
- Expo Go se bloquea en **Android e iOS antes de importar el SDK**. Web resuelve el adaptador `.web.ts`, que no importa ni Expo Notifications, ni Crypto, ni el adaptador nativo. Puede consultar la bandeja autenticada aunque no tenga push.

## Integración recomendada: un solo hook persistente

Importar desde `src/notifications/index.ts`:

- `bindNotificationApi(capturedSession, capturedRepository)` adapta directamente los seis métodos nuevos de `TechnicianRepository`.
- `useMobileNotifications({ session, storageKey, api, enabled, onOpen, onForegroundRefresh })` devuelve `{ client, state, storageKey, revokeForSession }`.
- `NotificationCenterScreen({ notifications, onBack? })` recibe ese mismo resultado.
- `NotificationStatusCard({ notifications })` permite mostrar el estado en otra vista sin crear otro cliente.
- `RunningTimersNotice({ data, selectedRangeLabel, serverRemindersReady, onOpen })` recibe el snapshot completo actual del panel, no una lista filtrada por búsqueda/pestaña. Aclara que solo cubre el rango cargado. No pausa ni ejecuta trabajos.

Montar el hook UNA vez por sesión en el padre, no dentro de una pantalla que desaparezca al navegar. Pasar `session: null` y `api: null` hasta restaurar y verificar sesión/trabajador/sucursal; no llamar al hook condicionalmente. `enabled` habilita la integración, **no** concede consentimiento. Usar `enabled: false` para demo/configuración no preparada. Los cambios de tenant, usuario, trabajador, sucursal, token o namespace crean un cliente nuevo con callbacks capturados; nunca se reasigna una promesa pendiente a la sesión siguiente.

`storageKey` debe ser el namespace canónico existente (incluye gateway, tenant, ambiente, usuario y sucursal). No incluir tokens en claves. El Session y repositorio capturados deben ser inmutables: construir el repositorio con esa sesión, no con un getter mutable de la sesión actual. `bindNotificationApi` rechaza llamadas con otra identidad/sesión/sucursal. Para cambios de gateway/configuración, cambiar el namespace.

`api` tiene estas firmas exactas; cada llamada usa la sesión CAPTURADA, no un ref a credenciales actuales:

| Callback | Repositorio adaptado |
| --- | --- |
| `notificationStatus(session)` | `notificationStatus(branch)` |
| `notificationRegister(session, input)` | `registerNotificationDevice(input)` |
| `notificationUnregister(session, installationId)` | `unregisterNotificationDevice(branch, installationId)` |
| `notificationInbox(session, page)` | `notificationInbox(branch, page)` |
| `notificationRead(session, eventId)` | `readNotification(branch, eventId)` |
| `notificationTest(session)` | `testNotification(branch)` |

Las respuestas se validan con los esquemas compartidos. El gateway autentica identidad real; jamás incorporar userId/workerId/origin/token de destino arbitrario al JSON de registro. POST de prueba no admite argumentos adicionales ni token: usa exclusivamente el registro propio almacenado. El repositorio conserva la responsabilidad de HTTP (verbos/rutas/query/cuerpo del contrato backend).

## Apertura segura: obligación explícita del padre

`onOpen(payload, context)` devuelve **boolean o Promise<boolean>**. `true` significa que el padre aceptó y manejó la navegación, no que el teléfono recibió un push. `context` contiene `session`, `storageKey` e `isCurrent()`.

1. El cliente valida esquema, UUID, fecha, IDs y tenant/sucursal exactos.
2. Como el payload NO lleva usuario/trabajador, comprueba además el evento propio mediante inbox autenticado FRESCO y compara todos los campos canónicos. No basta con reconocer el tenant. Nunca acepta un ID propio con otro workId/groupId inyectado.
3. El contrato no tiene GET por evento. La búsqueda recorre páginas de 25 hasta encontrarlo, terminar o llegar al límite contractual de 1000; no abre si no lo encuentra. Esta consulta puntual no es sondeo ni proceso en background. Un endpoint propio por ID podría sustituirla en una evolución del contrato, sin relajar la validación.
4. El padre vuelve a cargar el destino autorizado ACTUAL y comprueba `context.isCurrent()` después de cada await y justo antes de modificar navegación/estado. Devuelve false para recurso eliminado, ya no asignado, no autorizado, scope distinto o error. No abrir enlaces ni aplicar estados/pausas procedentes del payload.
5. Mapeo: work → direct/direct-np según recurso recargado; negotiation → external; maintenance → maintenance, con workId de maintenance_works. No adivinar direct-np ni sustituir por un espejo. Usar fecha del evento para consultar el destino; no asumir que pertenece a la semana visible. Para fecha null resolver con fuente canónica, no inventar fecha.
6. `MOBILE_PUSH_TEST` abre la bandeja/mensaje de prueba, nunca un trabajo nulo. Devolver true cuando esa acción quede atendida.

Solo tras aceptación se limpia la última respuesta, verificando que sigue siendo la misma; acciones nativas no predeterminadas se ignoran. Rechazos/fallos de navegación no consumen la respuesta. Se marca leído mediante API, independientemente del estado de transporte. Las interacciones automáticas se deduplican por eventId (máximo 256 por cliente/sesión); la apertura manual repetida desde inbox es intencional y vuelve a validar. El SO puede haber mostrado duplicados que la app no puede retirar retroactivamente.

`onForegroundRefresh(context)` también debe respetar `context.isCurrent()` tras await antes de escribir estado. Solo se llama tras comprobar propiedad del evento. Puede actualizar snapshot/bandeja visible; no debe cambiar la fecha o pausar trabajos automáticamente. Este módulo no instala un handler global de presentación que pueda reemplazar el de otra funcionalidad: con el comportamiento por defecto de Expo los mensajes de foreground no presentan banner del SO. El cliente publica un aviso en `state.notice` y delega el refresco; el padre puede mostrar ese aviso persistente en su UI. No instalar un handler que muestre payloads de otras cuentas sin comprobarlos.

## Registro y consentimiento

- Inicio/restauración/foreground: lee estado y permiso, nunca solicita permiso del SO. Solo vuelve a registrar automáticamente si hay opt-in persistido para el namespace y permiso concedido, provisional o ephemeral.
- `client.retryEnable()` únicamente desde una pulsación explícita de Activar. Verifica requisitos/proyecto ANTES del diálogo; configura el canal Android antes de solicitar permiso/token. iOS provisional se reconoce sin pedir de nuevo.
- Permiso bloqueado o canal desactivado → UI ofrece ajustes. Volver a foreground revalida permiso y desregistra la instalación propia cuando el SO lo revoca. No borra registros de otra instalación de la cuenta.
- El listener de rotación pasa `devicePushToken` a `getExpoPushTokenAsync`, evitando volver a obtener el token nativo dentro del listener. Operaciones serializadas por cliente; callbacks viejos no usan otra sesión.
- `savePreferences(preferences)` solo da éxito después de PUT confirmado. Asignaciones/timers, 30/60/120 minutos, repetición 120/240 (el servidor también admite 60 pero limita efectivamente a 120), horas HH:mm. Defaults: 30/120, silencio 22:00–07:00; inicio=fin permite todo el día. La zona horaria es de la sucursal.
- `loadInbox(more?)`, `markRead(eventId)`, `openInboxItem(eventId)`, `sendTest()`, `refresh()`, `disable()`, `openSettings()` devuelven Promise<boolean>; los errores sanitizados se reflejan en state, sin logs de tokens. La prueba pendiente NO se presenta como entrega.

## Logout y cambios de ámbito: requisito de seguridad

**Antes** de invalidar sesión, limpiar credenciales, cambiar tenant/cuenta/sucursal o desmontar el cliente: esperar `notifications.revokeForSession()`.

También se exporta `revokeForSession(client)` y el método equivalente en `MobileNotificationClient`. La función bloquea operaciones nuevas, quita listeners, espera registros ya iniciados, realiza DELETE con la sesión capturada y solo limpia respuestas/notificaciones presentadas cuya propiedad vuelve a verificar mediante esa sesión. No usa dismissAll ni borra datos de otras funcionalidades/cuentas. La instalación y el opt-in no se borran: la misma cuenta puede renovar registro tras re-login sin volver a preguntar un permiso ya concedido.

La limpieza puede rechazar (offline, sesión ya expirada, servicio deshabilitado). El padre debe mostrar el fallo, permitir reintento de DELETE con el cliente capturado cuando sea viable y **no omitir la invalidación upstream de la sesión antigua por ese fallo**. No conservar credenciales en logs ni reasignar ese cleanup al nuevo usuario. La invalidación upstream impide nuevos envíos; un push ya aceptado no se puede retirar. El cliente queda revocado y no puede reactivarse hasta establecer una sesión nueva. Un desmontaje por sí solo no es un logout seguro.

Alternativa sin UI: `NotificationBridge` recibe las mismas props más `onClient(client|null)` (callback estable; guardar instancia en ref). Esperar `revokeForSession(ref.current)` antes del cambio. No montar Bridge y hook simultáneamente. Para la pantalla/estado compartido, preferir el hook.

## Cronómetros y límites

No se programan recordatorios locales duplicados ni temporizadores de background. Avisos cerrada/segundo plano dependen de outbox/cron backend; el banner in-app es un snapshot del rango visible. Calcular `serverRemindersReady` conservadoramente: sesión real, registro/permiso vigentes, servidor habilitado, sin reconciliationStale ni lastFailure y preferencia timers activa. Aun así no es garantía de entrega.

UI distingue pending/sending, accepted (ticket Expo), receipt_ok (FCM/APNs), receipt_unknown, cancelado, vencido y fallo. Ninguno confirma lectura o presentación final en el teléfono. Muestra requisitos, última reconciliación, stale, disabledReason, lastFailure y deadLetters.

## Verificación

Pruebas aisladas añadidas en `tests/notification-client.test.ts` con SDK/API falsos y módulo web real. **No ejecutadas**; tampoco tests globales, lint, build, instalación o peticiones a backend/Expo. Diagnósticos del editor consultados, sin errores reportados al momento de implementación; no sustituyen TypeScript/build ni pruebas físicas.

Padre: incluir estas pruebas en el runner (el runner histórico solo descubre server/tests), verificar compilación Android/iOS/web y probar en dispositivos con credenciales reales: permiso denegado/provisional/canal desactivado, rotación, app cerrada, startup sin sesión restaurada, otra cuenta del mismo tenant, logout durante alta, servidor apagado, quiet hours y navegación tras desasignación. No se afirmó entrega física ni activación del servidor.