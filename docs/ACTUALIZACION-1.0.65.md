# Recepcion de materiales: APK 1.0.65 / gateway 1.0.29

En Avisos, Materiales por recibir muestra los comprobantes pendientes del usuario autenticado en su sucursal. Recibido confirma un comprobante; Recibi todo confirma solo los IDs y versiones cargados, hasta 200. Las entregas nuevas no vistas no se incluyen. El panel tecnico web incorpora la misma bandeja y abre las recepciones desde sus notificaciones.

No se solicita firma dibujada. El backend guarda usuario, fecha/hora del servidor, UUID, cliente WEB/MOBILE y ubicacion con precision e instante de captura, o PERMISSION_DENIED/TIMEOUT/UNAVAILABLE/UNSUPPORTED. No se generan movimientos de stock al confirmar. El GPS es declarado por el dispositivo, no una prueba certificada de presencia.

Un fallo de red conserva el intento exacto para reintento explicito. No se marca recibido hasta validar la respuesta; no hay sincronizacion automatica offline para esta accion. Versiones incompatibles o ubicacion vencida permiten revisar y confirmar otra vez. Las colisiones de UUID no se descartan automaticamente. Cambios de cuenta, sucursal o bloqueo impiden iniciar envios antiguos.

## Avisos y recordatorios

- Aviso inicial para entregas internas pendientes de recepcion. No cambia comprobantes historicos ya confirmados ni el modo NONE.
- Recordatorio diario mientras haya pendientes, dentro de los periodos configurados del trabajador y la zona horaria de la sucursal. Sin configuracion valida no se inventa un horario.
- El panel usa su bandeja persistente y socket posterior al commit. La app requiere permisos de notificacion, servicio push habilitado y preferencia Materiales por recibir.
- Las preferencias de notificaciones de Consumos se respetan. La confirmacion no exige tener activado push.
- No requiere permisos nuevos de Android ni ubicacion en segundo plano.

## Publicacion

Publicar fuentes de inventoryConsumptionsV2, mobileNotifications, notifications y cronJobs del backend, y las pantallas/servicios web. No se ejecuto build, tests, migraciones ni SQL del backend. El esquema vigente de Consumos V2 y MobileNotifications es requisito; esta entrega no agrega DDL.

Detener y drenar primero la unica instancia del backend. Desde su raiz:

```bash
npm install ./infrastructure/mobile-gateway/qualitzer-mobile-gateway-1.0.29.tgz --ignore-scripts --no-audit --no-fund
node scripts/check-mobile-sync-deployment.cjs
```

Iniciar una sola instancia fork cuando la verificacion corresponda al entrypoint desplegado. No usar reload solapado ni borrar claves, sesiones o colas. Actualizar la APK sin desinstalar la anterior.

## Verificacion local

55 archivos comprobados con TypeScript sin emision; 9 pruebas de contrato/diario/hook de recepcion, 3 pruebas HTTP de pasarela con backend simulado y 89 pruebas de notificaciones/navegacion pasadas. Cuatro flujos Chrome web/React Native Web a 390 y 1440 px verifican botones, reintento identico y ausencia de desbordamiento horizontal. Capturas e informe en artifacts/receipt-ui/2026-09-29T18-35-54-052Z.

Las pruebas backend estan preparadas, no ejecutadas. Pendiente comprobar una entrega real, transacciones MySQL, recordatorios segun horario real, push y GPS en telefono fisico tras desplegar. No se enviaron notificaciones reales ni se confirmaron productos reales durante estas comprobaciones.

## Artefactos verificados

APK1.0.65/code66: 74021505 bytes, SHA-256 `4cf27b43c17f80e9c0a7fe52703604d40d1e86d6720c42fedc668704a17d9ca6`. Auditoria 2026-09-29T19:08:17Z: mismo certificado, sin permisos nuevos, APK1.0.64 intacta, fuentes y recursos nativos coincidentes, bloqueo de compilacion liberado.

Gateway1.0.29: 600320 bytes, SHA-256 `cf95214a8a08cb99ab2afac8e4da7ae2fa5d759aa25e237049497f83dbb2566f`. Dos empaquetados identicos, carga aislada Node20.12.2 y copia al backend verificadas. TGZ, checksum y manifiesto no ignorados, pero todavia sin agregar a un commit. No se instalo en el backend.

Descargas completas verificadas a las 19:12:08Z desde http://192.168.1.105:8840/ en la misma red local. QR: artifacts/qr-descarga-1.0.65.png. La direccion depende de que este equipo conserve su IP y el servidor siga ejecutandose.

El diagnostico local confirma fuentes y referencias actuales; falla deliberadamente en build antiguo y gateway instalado anterior. No representa el servidor remoto ni autoriza a omitir la publicacion. Informes: artifacts/material-receipts-delivery-1.0.65-gateway-1.0.29.json y artifacts/material-receipts-backend-deployment.json.