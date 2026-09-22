# Qualitzer técnicos

## Instalación, producción y otros entornos

Empezar por el **[manual completo paso a paso](docs/MANUAL-INSTALACION-PRODUCCION.md)**: backend, migraciones, variables, frontend web, Expo/Firebase, firma, APK, instalación y verificación. Cada fase distingue acciones de una persona, de la IA y operaciones que requieren autorización.

**Configuración de API vigente:** definir únicamente `BACKEND_URL` con la ruta `/api` en el [.env](.env) local o en el entorno CI/EAS. La app, Expo y la compilación derivan `/mobile` en el mismo servidor, sin dominios en el código ni en las pruebas. No configurar `EXPO_PUBLIC_GATEWAY_URL` manualmente. Detalles: [configuración por entorno](docs/CONFIGURACION-BACKEND.md).

`npm start` inicia Expo contra ese gateway ya desplegado. `npm run gateway` conserva el arranque independiente de la pasarela local para soporte; no cambia automáticamente el destino de la app. Cambiar `.env` requiere reiniciar Expo o generar otra APK, no modificar código al hacer merge.

- [Ficha para un nuevo entorno o pase](docs/PLANTILLA-PASE-ENTORNO.md)
- [Guía específica del backend](../Qualitzer2.0-Backend/docs/INSTALACION-APP-TECNICOS.md)
- [Guía específica del frontend web y administración](../Qualitzer2.0-Frontend/docs/INSTALACION-APP-TECNICOS.md)
- [Entrega Android 1.0.5](docs/ACTUALIZACION-1.0.5.md) y [estado de configuración push](docs/ACTIVAR-NOTIFICACIONES.md)

**Las secciones siguientes conservan notas de la preparación inicial.** Sus indicaciones Expo Go, puertos locales, versiones y límites antiguos no son el procedimiento vigente para producción; utilizar el manual anterior y las notas de versión.

Aplicación móvil independiente para técnicos de Qualitzer, desarrollada con **React Native + Expo 57 + TypeScript**. Corre en Android, iPhone y navegador. Su código y dependencias están fuera de los proyectos existentes.

**Estado de integración (09-09-2026): backend y frontend en `app-mobile`; frontend sin cambios en esta mejora.** Integrados: eliminación del espejo duplicado de mantenimiento cuando la relación está verificada, tarjetas de trabajo planas, conexión/sincronización más claras, cabecera sin URL del portal, selección de checklists empresariales y búsqueda de equipo por número interno. Resumen: [docs/MEJORAS-TECNICO.md](docs/MEJORAS-TECNICO.md). Las tres migraciones tenant originales requieren verificar su estado por entorno: no se ejecutaron automáticamente y no se confirmó si el usuario ya las aplicó. Push continúa pendiente de activación; código y pruebas ficticias no acreditan funcionamiento productivo completo.

## Probar ahora, sin experiencia móvil

### En este computador

1. Abre esta carpeta y haz doble clic en **[INICIAR.cmd](INICIAR.cmd)**.
2. Se inician la app y su pasarela. Se abre **http://localhost:8081**.
3. Usa **Explorar demostración**, con datos ficticios separados, o ingresa con **usuario y contraseña de Qualitzer**: una empresa coincidente permite entrar automáticamente; varias requieren elegir entre esas coincidencias. Para validar operaciones reales, utiliza una cuenta y asignaciones de prueba autorizadas.
4. No cierres la ventana de arranque mientras pruebas. **Ctrl+C** detiene esta app; no detiene Qualitzer.

Las dependencias ya están instaladas. **[INSTALAR.cmd](INSTALAR.cmd)** solo es necesario si eliminas las dependencias o copias el proyecto a otro computador. Requiere Node/npm y conexión a internet; instala un Node 22 propio sin reemplazar el Node de Qualitzer.

Para editar el proyecto en una ventana independiente, abre **[Qualitzer-Mobile.code-workspace](Qualitzer-Mobile.code-workspace)**.

### En tu teléfono

1. Instala **Expo Go**, la aplicación gratuita de Expo, desde [Google Play](https://play.google.com/store/apps/details?id=host.exp.exponent) o [App Store](https://apps.apple.com/app/expo-go/id982107779).
2. Conecta teléfono y computador a la **misma red Wi-Fi**.
3. Deja abierto el arranque del computador y abre la app web. En desarrollo, el **QR permanece visible en escritorio**, incluso después del acceso; en móvil, una pastilla abre el QR y sus instrucciones en un modal. No necesitas buscarlo en la terminal.
4. **Android:** abre Expo Go y escanea ese QR. **iPhone:** escanéalo con Cámara y abre Expo Go.
5. Usa demostración o una cuenta técnica de pruebas. Sólo se pide empresa si hay varias coincidencias válidas.

El panel muestra el enlace Expo y la pasarela con la IP LAN actual. **Actualizar** conserva el mismo QR mientras no cambie la dirección; si cambias de red, actualízalo y escanea el nuevo. Si la app conserva una pasarela anterior, corrígela desde **Conexión**. No uses `localhost` en el teléfono: se referiría al teléfono, no al computador. Sin LAN privada detectada, el panel avisa; no crea un túnel público.

Expo Go requiere una versión compatible con SDK 57. Esta versión del proyecto requiere Android 7+ o iOS 16.4+. Windows no ejecuta el simulador de iPhone; la prueba iOS se hace con un iPhone físico. No necesitas Android Studio ni una cuenta de pago para esta prueba con Expo Go.

**Expo Go no permite probar el push remoto de esta app**, ni en Android ni en iOS. Se necesita una compilación nativa de desarrollo/distribución con proyecto Expo y credenciales configurados. En navegador sólo hay bandeja autenticada cuando el servidor la habilita, no push del navegador.

## Funciones incluidas

- Acceso con usuario/contraseña, selección posterior sólo entre empresas coincidentes y cambio de contraseña temporal cuando corresponda.
- Perfil y selección de sucursal autorizada.
- **Mi jornada** abre hoy; **Agenda** reúne siete consultas diarias y ofrece cuadrícula horaria Día/Semana, estados, carga planificada diaria/semanal y cruces. No inventa una capacidad de ocho horas ni confunde carga con tiempo ejecutado. Búsqueda por equipo/trabajo y filtros por estado.
- **Crear** desde jornada/agenda: trabajo propio, tiempo no productivo y OT interna **correctivo/detención** con primer trabajo. Asistente Datos → Horario → Revisar, planificación de un mismo día y solicitud UUID idempotente persistida. Al confirmar se refresca la fecha creada.
- **Equipo por número interno**: búsqueda exacta, sin convertir a número ni perder ceros; exige seleccionar un resultado incluso si sólo hay uno. Conserva el ID elegido en borrador/revisión y lo envía como `work.rentalEquipmentId` o `maintenance.equipmentId`. Offline sólo dispone de consultas cacheadas, no acredita disponibilidad actual del servidor.
- **Avisos**: centro con estado del servidor/dispositivo, bandeja, preferencias, lectura y prueba al dispositivo propio. Activación por consentimiento explícito; demo y servidor deshabilitado se muestran como tales, no como éxito. Push remoto implementado pero **pendiente de activar y probar físicamente**.
- Trabajos directos, incluidos no productivos, OT externas y mantenimiento interno. Tarjetas con códigos TR, metadatos de OT/negociación cuando existen y avance del trabajo.
- **Trabajos** muestra tarjetas planas por fecha, con la referencia OT dentro de cada tarjeta; **OTs** conserva su vista independiente. La proyección canónica compartida elimina el espejo estándar sólo cuando `maintenanceWork.workId` verifica la relación y el hijo asignado está presente; no fusiona por título o equipo.
- Iniciar, pausar, reanudar y entregar trabajos hijos. Tiempo automático desde el cronómetro confirmado; edición manual sólo con permiso vigente de sucursal. En trabajos estándar, entrega de hasta **30 fechas explícitas**, reautorizadas día por día; no usa `finalizeAll` ni `finalizeAllDays`.
- Checklists con asistente de **un paso a la vez**, comentarios y archivos de trabajo/paso para ambas fuentes mediante las rutas actuales de documentos. Imágenes, PDF, DOCX, XLSX, TXT y CSV: **25 MiB por archivo**, hasta **4 pendientes / 40 MiB** en la UI, enviados secuencialmente tras confirmar.
- **Checklists de la empresa → Agregar checklist**: catálogo activo por nombre/código, páginas de 20 y confirmación manual; visible sobre los checklists incluso si aún no hay ninguno. Sólo online sobre un trabajo canónico no cerrado/entregado. Añade respuestas en blanco sin reemplazar listas, respuestas ni evidencias existentes; no crea maestros ni permite quitarlos.
- Inicio y entrega de la **OT de mantenimiento**, separados del trabajo hijo. Firma técnica PNG obligatoria; correctivo/detención requieren además tipo de falla, receptor y firma del cliente. Captura de firma implementada para web y nativo; dispositivos físicos pendientes.
- Un padre entregado **no bloquea por sí solo al hijo**. El cierre del hijo deja sus respuestas/estados en solo lectura, no los comentarios ni los gestores genéricos de archivos; siguen exigiéndose asignación y permisos actuales.
- Ficha y documentos del **equipo asociado a la asignación**, según los datos disponibles. No se adivinan relaciones con el catálogo maestro por matrícula o número interno.
- Cola offline durable para creaciones, comentarios nuevos, respuestas y archivos, aislada por identidad/sucursal; sincronización automática en primer plano. SQLite WAL nativo e IndexedDB web conservan estado y bytes propios después de **Guardar archivos**. La selección web anterior al botón sigue siendo temporal.
- Conexión separada de caché: **Sin red**, **Sin acceso a Qualitzer**, errores del servidor o sesión pendiente no significan lo mismo. Al volver a la app se reanuda la comprobación; comentarios/fotos dependientes esperan la creación y sus IDs canónicos. El centro muestra el motivo de espera y deja IDs/JSON en detalles contraídos.
- Preparación inicial automática de asignaciones semanales y catálogo combinado. **Sin conexión → Preparar este período** amplía explícitamente metadatos, comentarios y primeras páginas de catálogo; **no descarga bytes de fotos/documentos remotos**. Revisar cobertura antes de salir.
- Modo demostración explícito e independiente de los datos reales. Los datos confirmados de demo viven en memoria y se reinician al recargar; no son reportes productivos.

**No es una migración completa del panel administrativo.** Crear mantenimiento preventivo/rutinario/checklist sigue requiriendo el asistente web de pautas/rutinas/listas; no se habilita un formulario vacío equivalente. Siguen pendientes edición de trabajos/materiales/responsables, creación administrativa y quita de checklists; **asociar uno existente ya está implementado online**. Consultar materiales no registra consumos. Matriz en [docs/PANEL-TECNICO.md](docs/PANEL-TECNICO.md); creación, agenda y avisos en [docs/PLANIFICACION-Y-AVISOS.md](docs/PLANIFICACION-Y-AVISOS.md).

## Cómo se conecta a la misma base de datos

**App → pasarela móvil → API de Qualitzer → base de datos existente.**

La pasarela consume HTTP, sin conexión SQL ni credenciales de base de datos. **Sólo se configura `BACKEND_URL` como destino de API; no la URL del proyecto frontend.** El backend administra las empresas en su registro master y resuelve las credenciales. Las APIs operativas legacy conservan su Origin interno, derivado del catálogo autoritativo: no se reescribe cada módulo ni cambia el login web/JWT existente. Guía: **[docs/CONFIGURACION-BACKEND.md](docs/CONFIGURACION-BACKEND.md)**; integración de recursos: [docs/PANEL-TECNICO.md](docs/PANEL-TECNICO.md).

Configuración local ya preparada:

| Ajuste | Valor |
| --- | --- |
| Backend | `http://127.0.0.1:5001/api` |
| Portal local devuelto por el backend (no configurar) | `http://localhost:3000` |
| Pasarela | Puerto `8787` |
| Expo / web | Puerto `8081` |

En **[.env](.env)** ya se retiraron `TENANT_ORIGIN` y `GATEWAY_TENANTS_FILE`; los ajustes de conexión son `BACKEND_URL`, puerto, host y CORS de la pasarela. Antes, `TENANT_ORIGIN` era una cabecera hacia el backend, **no una llamada al frontend**; ahora el backend la determina. CORS sigue autorizando el navegador Expo en 8081/por LAN, no elige empresa; nativo no necesita enviar Origin.

**[config/tenants.json](config/tenants.json) ya no es la lista automática de empresas. Conservarlo como referencia histórica exacta para migrar sesiones cifradas V1 → V2; no borrarlo antes de arrancar.** V2 conserva alias y namespaces offline sin necesitar ese archivo en adelante. Las variables legacy explícitas siguen disponibles sólo como compatibilidad deprecada: retirarlas también del proceso heredado, no dejarlas vacías. Procedimiento y errores seguros en [docs/CONFIGURACION-BACKEND.md](docs/CONFIGURACION-BACKEND.md).

Los cambios hechos con tu **cuenta real sí afectan Qualitzer**. Usa demostración para explorar, o asignaciones de prueba autorizadas para validar la integración real. Todas las llamadas de API van al `BACKEND_URL` fijado; `portalOrigin` es metadata canónica/clave interna, nunca un destino HTTP al frontend. La sesión queda ligada a la empresa verificada y una solicitud no puede cambiarla manteniendo el mismo token.

### Empresas y entornos

- El catálogo local devuelve `tenant-1`, con Origin `http://localhost:3000`; su nombre interno conocido es `jaras` y el branding conocido es `Grupoeliseo`. El alias histórico `grupo-eliseo-local` se conserva al verificar la migración; no es otra empresa ni un dominio productivo.
- El **backend** comprueba las credenciales en todas las empresas activas del master, hasta 50, sin abrir sesiones durante discovery. Una coincidencia permite completar automáticamente; varias requieren una selección breve. Si la comprobación queda incompleta/no disponible, se bloquea el acceso sin elegir una coincidencia parcial.
- Las altas/bajas se administran en el **backend**, que expone config/discover/complete neutrales sin Origin. La pasarela refresca antes del login/completado y al vencer 60 segundos en peticiones protegidas; las altas no exigen reinicio. Una baja confirmada retira sólo sus sesiones; un fallo de catálogo no activa fallback legacy ni parcial. Backend caído al arrancar: cierre seguro con error claro, sin borrar datos.
- El GET neutral publica nombres saneados y orígenes, no credenciales ni `dbName`. Restringir su exposición por red en despliegue; CORS no es protección del catálogo.
- Empresa y sucursal permanecen visibles según la sesión actual. La cabecera no muestra ni anuncia por accesibilidad la URL del portal; `portalOrigin` se conserva internamente para identidad y namespaces, sin cambiar autenticación. Para cambiar de empresa, pulsa **Cerrar sesión** cuando no haya pendientes y vuelve a ingresar tus credenciales.
- Se confirmó en una consulta de solo lectura que la OT 80 contiene **13 trabajos: 2 con responsables explícitos y 11 heredados**. Se retiró el filtro adicional por `responsibles` que los reducía a 2 en móvil. La pertenencia se comprueba con un GET canónico fresco; un trabajo no productivo `direct-np-*` incluido allí ya no se oculta por tener responsables vacíos. No se habilita acceso arbitrario a otros trabajos.
- Si un listado difiere, compara empresa, sucursal, usuario y día. La agenda consulta cada día por separado porque el agregado del backend está centrado en la fecha de inicio.

## Dónde quedan comentarios y archivos

Estos contratos están implementados en móvil/pasarela y sus recursos backend están presentes en `app-mobile`. La persistencia y visibilidad compartida todavía requieren una prueba autenticada.

- **Comentarios actuales:** rutas de panel según fuente. En mantenimiento, el backend resuelve el trabajo espejo mediante `maintenanceWork.workId`; no trata el ID del hijo de mantenimiento como ID estándar ni sobrescribe la nota global de OT.
- **Checklist:** respuesta del paso correspondiente. La lectura dedicada `GET /steps/:stepId/files` recupera sus adjuntos desde una asignación canónica fresca.
- **Documentos actuales:** gestores de OT/trabajo y pasos estándar/mantenimiento. Los pasos estándar se vinculan mediante `work_files` y un namespace de ruta que permite hidratarlos sin mezclar pasos.
- **Compatibilidad legacy:** `/report` conserva comentario técnico estándar o TXT de mantenimiento; los antiguos POST fotográficos `/files` no sustituyen el flujo actual `/documents`. El rechazo de paso estándar de esa ruta legacy no describe las capacidades actuales del panel.

Las escrituras admitidas por el decorador offline se guardan **primero en la cola local**, antes de intentar el envío. Reconectar con la app abierta permite reintentos con **el mismo UUID, cuerpo y bytes**, más recibos. Los errores específicos de esquema/ruta pendiente de despliegue esperan al menos 60 segundos y se recuperan al estar disponible el servidor; no se reinician conflictos genéricos, rechazos ni revisiones. Inicio/pausa/entrega, asociación de checklist, borrado y reporte legacy siguen sólo online y sin cola. No borrar almacenamiento ni crear otra solicitud ante una respuesta incierta. Detalles en [docs/OFFLINE.md](docs/OFFLINE.md).

## Conexión, sesión y privacidad

- En Android/iOS el token opaco `qzm_` se conserva en **SecureStore**. Nunca se guarda la contraseña ni se entrega el JWT backend al cliente.
- En navegador la sesión usa una **cookie HttpOnly**; el registro de sesión accesible por JavaScript conserva `cookie-session` y metadatos de empresa/conexión/sucursal, no el token real en localStorage. Separadamente, IndexedDB contiene el perfil mínimo y datos/archivos operativos potencialmente sensibles. Recargar puede recuperar la sesión mientras siga válida y el navegador conserve la cookie.
- La pasarela guarda las sesiones cifradas con **AES-256-GCM** en su directorio privado .data, con permisos POSIX o ACL de Windows. Reiniciarla conserva las sesiones si permanecen intactos el almacén, la clave y la configuración vinculada. Un cambio incompatible bloquea el arranque y requiere intervención administrativa; no borres sólo el marcador de fallo.
- Ya no existe el límite artificial de siete días. Se respeta la expiración upstream; la plantilla actual del backend configura diez años, **no una sesión infinita ni una garantía del entorno desplegado**. Expiración, cambios de contraseña, revocación administrativa o acceso desde otro teléfono pueden exigir nuevo login. Sigue vigente la limitación upstream de una sesión móvil por usuario/tipo de dispositivo.
- El snapshot cifrado V1 compatible migra una sola vez a V2 con huella y rutas exactas, preservando alias y ámbitos offline. Si falta/difiere la referencia histórica, se bloquea sin resetear ni borrar borradores. Esto no migra JWT crudos del cliente ni sesiones antiguas sin identidad de tenant; esos casos requieren reautenticación, sin eliminar pendientes para resolverlos.
- SQLite, caché y archivos operativos no están cifrados por la app; pueden contener datos sensibles aunque el perfil almacenado sea mínimo. Usa bloqueo de pantalla y dispositivos de confianza. No se garantiza recuperación tras desinstalar, borrar datos o sufrir daños/expulsión del almacenamiento.
- **Cerrar sesión se bloquea si hay pendientes**, incluso en otra cuenta/sucursal; cambiar de sucursal exige conexión y ausencia de pendientes en la actual. No se borra la cola ni se apropia automáticamente otra cuenta de ella. Un cierre permitido retira sesión y borradores no encolados, pero conserva cola/caché. Una expiración/401 detiene envíos conservando pendientes: volver a ingresar con la misma cuenta permite revalidar y continuar.
- El primer acceso requiere conexión. En arranques posteriores, sólo un `NetworkError` permite recuperar el perfil previamente verificado y ligado mediante hash a la sesión live actual; errores de autorización no se ocultan con caché. La sincronización es automática **en primer plano**, no garantizada con la app cerrada: mantenerla abierta al reconectar.
- El E2E web mantiene disponible el servidor del cliente y corta la pasarela: **no demuestra un shell web offline ni PWA**. Android/iOS standalone con bundle instalado puede arrancar sin Metro; Expo Go no garantiza arranque en frío sin servidor de desarrollo. Los avisos remotos son otro flujo, dependiente de backend/proveedor/SO y sin garantía de entrega.

## Marca de la empresa

Dentro de la app, nombre y logo se adaptan a los datos válidos que la pasarela obtiene de `/companies/branding`; si faltan, se usa el nombre de la empresa y/o la imagen genérica. La sesión observada más recientemente corresponde a **Heavytech**, sin URL en la cabecera; la observación anterior de Grupoeliseo no fija la marca para otras sesiones.

El icono y nombre instalados en Android/iOS **no cambian al iniciar sesión**, y Expo Go sigue siendo Expo Go. Una distribución con marca requiere preparar recursos y compilar otra aplicación. El preparador consulta el branding real sin credenciales y conserva iconos genéricos si no hay logo; no compila un APK/IPA. **[scripts/prepare-company-brand.cjs](scripts/prepare-company-brand.cjs) aún usa [config/tenants.json](config/tenants.json) en formato legacy:** es un CLI separado, no el catálogo del acceso actual ni una herramienta ya migrada. Pasos en **[docs/BRANDING.md](docs/BRANDING.md)** y precaución V1 en [docs/CONFIGURACION-BACKEND.md](docs/CONFIGURACION-BACKEND.md).

## Si algo no abre

| Problema | Qué revisar |
| --- | --- |
| Navegador no conecta | Deja abierta la ventana de arranque; comprueba que no haya otra app en 8081/8787 |
| Teléfono no conecta | Misma Wi-Fi, sin aislamiento de clientes/VPN; verifica IP; permite Node en **redes privadas** si Windows solicita permiso |
| Demostración funciona, acceso real no | Revisar `BACKEND_URL`, config/discover/complete, catálogo master, credenciales y permisos; no configurar una URL frontend. Un login autorizado ya se comprobó, sin acreditar todos los entornos |
| Hay Wi-Fi pero no sincroniza | Distinguir Sin red, Sin acceso a Qualitzer, fallo de servidor y sesión. Mantener la app en primer plano y revisar el motivo de cada pendiente; una señal de red no garantiza acceso a Qualitzer |
| Servidor requiere actualización | Verificar despliegue/esquema del tenant; la cola conserva UUID y contenido y espera al menos 60 segundos. No borrar datos ni reiniciar conflictos genéricos |
| Sigue apareciendo modo legacy | Retirar `TENANT_ORIGIN` y `GATEWAY_TENANTS_FILE` del archivo y del entorno heredado del terminal/IDE/servicio; no dejarlas vacías |
| La selección de empresa venció | Vuelve al acceso e ingresa tus credenciales; no se reutiliza la selección anterior |
| No aparecen trabajos | La cuenta debe tener trabajador asociado, sucursal habilitada y trabajos asignados; revisa el día o la semana seleccionados |
| Error de persistencia al arrancar | Un administrador debe revisar clave, almacén y configuración; no borrar sólo el marcador ni restaurar sesiones incompatibles |
| Cámara no abre | Autoriza cámara en ajustes o usa galería; el navegador de escritorio no equivale a cámara nativa |
| No se ven archivos/comentarios del panel | Confirmar despliegue de recursos y recibos sync; refrescar online. Preparar no descarga bytes remotos. HEIC no está admitido en el transporte offline: convertir antes a JPEG/PNG y conservar esos bytes |
| App cerrada en el teléfono | Los cronómetros abiertos continúan según la lógica del servidor; pausa desde la app cuando dejes de trabajar |

No se desactiva el firewall ni se abre acceso público automáticamente. El launcher utiliza HTTP solo para desarrollo en una red privada de confianza.

## Estado de verificación

- Validación final: **591 casos, 590 aprobados, 1 omitido por plataforma y 0 fallidos**. TypeScript app/pasarela sin errores y exportación Expo Android/iOS/web completada después de los cambios de conexión, checklists y equipos.
- **E2E offline PASS**: reconexión automática, recarga y respuesta de documento perdida recuperada sin duplicar efectos. **E2E checklist/equipo PASS** en demo y pasarela ficticia, navegador 390×844, cabecera sin URL del portal ni desbordamiento. Fixture 8788 detenida. Alcance en [tests/e2e/README.md](tests/e2e/README.md).
- Se realizó login real autorizado y lectura de catálogo/asignaciones, sin mutaciones operativas reales para esta validación. Cuatro trabajos reales terminales no admitían asociación; el éxito se comprobó en demo/fixture, no forzando sus estados.
- El IndexedDB del navegador compartido contenía **seis operaciones ya aplicadas**, no los padres `local-94…` de las capturas del usuario. **La cola concreta de esas capturas no pudo verificarse ni se declara reparada.**
- Esta edición sólo modifica documentación: sin comandos de pruebas, lint, build, migraciones ni cambios de permisos del editor. El estado SQL actual debe verificarse por tenant; faltan pruebas físicas Android/iPhone, SQL concurrente y push real.

Evidencia y límites completos: [docs/MEJORAS-TECNICO.md](docs/MEJORAS-TECNICO.md). Una exportación previa o una captura de navegador no equivale a un APK/IPA firmado ni a una prueba de dispositivo.

## Publicar o instalar sin Expo Go

Es una etapa distinta: requiere compilar y firmar la aplicación y desplegar la pasarela en HTTPS.

**[eas.json](eas.json)** define perfiles de build, no binarios ya construidos ni publicaciones verificadas. La distribución iOS requiere la firma/cuenta correspondientes de Apple.

Antes de distribuir a técnicos reales:

1. Desplegar el backend `app-mobile` con config/discover/complete neutrales y recursos operativos en los tenants activos. Configurar sólo `BACKEND_URL` como destino, no el proyecto frontend; sus componentes web relacionados son independientes de esta conexión móvil. Conservar la referencia histórica hasta verificar V1 → V2. Reforzar autorización por recurso o impedir saltarse la pasarela: esta integración **no corrige globalmente** los endpoints operativos antiguos.
2. Usar HTTPS, proxy confiable y allowlist CORS explícita; operar el almacén de sesiones con **una única instancia escritora**, no varias réplicas compartiendo el archivo.
3. Validar login y operaciones con una cuenta técnica de pruebas de cada tenant/sucursal.
4. Probar cámara, permisos, pérdida de conexión, expiración de sesión y cronómetros en dispositivos físicos.
5. Validar comentarios/espejos, hidratación y borrado de evidencia estándar, entrega multifecha y recepción firmada real; revisar los límites de autorización y recuperación de sesiones documentados.
6. Verificar las tres migraciones tenant originales y aplicar sólo las que falten, incluida la de recibos sync. Para avisos, completar configuración backend y compilación nativa con proyecto coincidente y credenciales FCM/APNs; validar el estado y la entrega física sin prometerla. Ver [docs/PLANIFICACION-Y-AVISOS.md](docs/PLANIFICACION-Y-AVISOS.md).

Detalles de autorización, límites y restricciones en **[server/README.md](server/README.md)**.

## Desarrollo

Scripts disponibles en **[package.json](package.json)**: `start`, `mobile`, `web`, `gateway`, `typecheck`, `test`, `export:web`, `export:mobile`. Su presencia no implica que se hayan ejecutado para esta integración. Configuración técnica en **[server/README.md](server/README.md)** y distribuciones por empresa en **[docs/BRANDING.md](docs/BRANDING.md)**.#   q u a l i t z e r - t e c h n i c i a n s 
 
 