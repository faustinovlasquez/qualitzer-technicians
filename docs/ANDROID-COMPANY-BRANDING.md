# Empresa en la pantalla de inicio de Android

## Compilación integrada

Los cambios del 11 de septiembre están integrados en **Qualitzer técnicos 1.0.3 / código 4**, compilada y firmada con la misma identidad. La verificación del APK y sus fuentes está completa; no se añadieron permisos. La apertura en frío mediante la actividad del acceso se comprobó en emulador API 36 sin el diálogo previo. La confirmación automática del pin y el aspecto en lanzadores físicos siguen pendientes de prueba.

## Qué cambia realmente

- La aplicación base está compilada como **Qualitzer técnicos**, con el logo Qualitzer. El paquete sigue siendo `com.qualitzer.field`; la personalización en runtime no modifica nombre/icono instalados ni firma.
- Después de establecer una sesión real verificada, se personaliza la tarjeta de **Recientes**. Android y el lanzador deciden si muestran ese nombre/icono; no equivale a renombrar la app del cajón.
- Se solicita automáticamente un **acceso directo anclado** (API 26+) después de una sesión live con sucursal habilitada, restauración/setup/password terminados, conexión autorizada online y nombre/logo preparados por el módulo. No se solicita durante demo, restauración offline sin verificación online, bloqueo 401 o una operación ocupada. Si el logo falta o falla su validación/descarga, se usa Q como fallback explícito.
- Android conserva su confirmación obligatoria; no hay anclado silencioso, permisos adicionales ni aliases de launcher. **Mi perfil → Empresa en tu teléfono → Añadir empresa a pantalla de inicio** permite reintentar manualmente.
- `true` de Android significa solicitud aceptada, no acceso añadido. La UI dice **Confirma en Android**; solo el receptor privado del callback informa confirmación. Cancelar no genera callback. Un pin ya existente se mantiene, no se duplica.
- Antes de solicitar al lanzador se crea atómicamente un marcador vacío por hash de empresa en `Context.noBackupFilesDir/company-shortcut-requests`. No contiene identidad autorizada, token, usuario, URL, nombre ni logo. Sobrevive reinicios, logout y actualizaciones de la misma instalación; no se restaura desde backup. Una cancelación o ausencia de callback no provoca otra solicitud automática. Un intento manual también marca la empresa como ya solicitada. Si el marcador no puede guardarse, no se solicita. No borrar datos ni reinstalar para reintentar: usar el botón del perfil.

## Identidad y apertura

El ID estable es `qz-company-` + SHA-256 de la tupla versionada que incluye **gateway completo (incluida ruta base), tenant.id, portalOrigin y environment**. No incluye usuario, contraseña, token ni sucursal. Cambiar nombre/logo o sucursal actualiza el mismo pin de esa empresa; otra empresa/gateway obtiene otro ID.

El intent de acceso solo lleva ese hash opaco y una acción constante hacia `CompanyShortcutActivity`. Se conservan actividad, acción, extra e ID de los accesos antiguos. Tras validar la forma del intent, abre directamente `MainActivity` con un intent constante, sin extras ni URL y **sin el diálogo «Comprueba la empresa al ingresar»**. No consulta identidad de sesión en memoria: en arranque en frío esta todavía no existe y el lifecycle la invalida antes de restaurar React. La app restaura su sesión existente mediante el flujo normal, o muestra login si no corresponde restaurarla. Un acceso con etiqueta de otra empresa tampoco cambia de tenant: abre la sesión actual. Tokens, tenants y deep links inyectados no se reenvían. Nunca autentica ni selecciona tenants automáticamente. Cada callback privado tiene identidad aleatoria propia, inmutable y de un solo uso, evitando reutilizar un PendingIntent anterior tras reiniciar el proceso.

Logout, sesión revocada, demo, restauración/setup/password pendientes o cambio de empresa invalidan inmediatamente la generación nativa. Luego se deshabilitan los pins de empresa y se restaura Recientes desde los recursos instalados. Al reautenticar la misma empresa se actualiza y rehabilita su pin existente, sin volver a fijarlo. Un callback tardío de otra empresa deshabilita únicamente su propio pin. Android puede mantener pins deshabilitados en gris; la app no promete borrarlos del escritorio.

La personalización visual conserva la sesión autorizada existente, incluido el perfil offline previamente verificado. La solicitud automática exige además estado online `ready`, app en foreground y la sucursal seleccionada habilitada; sin controlador offline exige el indicador `offlineVerifiedAt` establecido tras la verificación live. El perfil restaurado offline por sí solo no habilita la solicitud. También se bloquea con `offline.authBlocked`; no se usa un tenant seleccionado antes del login como prueba. Una identidad visual o el marcador de solicitud no constituyen autorización del servidor.

## Logos y límites

- Data URIs base64 canónicas PNG/JPEG/WebP y URLs HTTPS públicas validadas, hasta **512 KiB** de imagen. Validación inicial JS y nueva validación nativa del MIME/firma detectados.
- Kotlin lee dimensiones antes de decodificar: máximo **2048 × 2048**, muestreo y lienzo final **256 × 256** que conserva proporción.
- Decodificación y llamadas al gestor de shortcuts en `Dispatchers.IO`; únicamente `setTaskDescription` se aplica en el hilo principal.
- La descarga HTTPS usa OkHttp con validación TLS habitual y de direcciones DNS públicas, plazo de diez segundos, sin redirecciones, cookies ni autorización. Rechaza destinos locales/privados y respuestas que excedan los límites. SVG, imágenes inválidas, ausentes o inaccesibles usan **el icono instalado Qualitzer**, declarado expresamente en el perfil. No se afirma que ese fallback sea el logo empresarial.
- Caché de logos limitada en memoria, sin SharedPreferences ni datos de sesión persistidos por este módulo. Los únicos archivos propios nuevos son los marcadores vacíos de solicitud; Android conserva las etiquetas/iconos de los accesos confirmados por el usuario.
- Recientes utiliza el constructor Bitmap soportado (aunque deprecated) para logos runtime; el builder API 33 solo admite recursos instalados. No usa la sobrecarga `setIcon(Icon)` añadida en API 37, fuera de compileSdk 36.

## Integración

- Local Expo module: `modules/company-branding`, `expo-module.config.json`, Gradle library con `expo-module-gradle-plugin`, manifiesto fusionable y clase `CompanyBrandingPackage` para reset temprano al crear la actividad.
- SDK 57 descubre por defecto `./modules`. No requiere dependencia npm nueva ni plugin en la configuración global. El build release y su auditoría verificaron la clase Kotlin y el manifiesto fusionado.
- `App.tsx` llama `useCompanyBranding` antes de sus retornos de login y pasa `companyBranding` obligatorio a `ProfileScreen`. No se modifica `useTechnicianApp` ni el flujo de autenticación.
- Expo Go, iOS, web o una APK previa sin el módulo: degradación segura y botón deshabilitado, sin crash por módulo ausente.
- Las actualizaciones conservan `com.qualitzer.field`, **la misma clave de firma existente** y los recursos base Qualitzer técnicos; requieren un versionCode creciente. No desinstalar ni borrar datos para actualizar.
- La sincronización depende de campos estables de la identidad y su marca, no de cada objeto de tenant ni de cada cambio de foco. Los errores recuperables de Recientes y callbacks se contienen sin ocultar cancelación ni errores fatales de memoria.

## Validación

- Revisión del 11 de septiembre: **30 pruebas JS aprobadas, 0 fallos; diagnósticos TypeScript focalizados 0**, incluyendo el cableado de App y los tests nuevos. No se ejecutaron validaciones globales.
- **15 regresiones JVM aprobadas** (persistencia/concurrencia del marcador, seguridad, callbacks y logos) y **4 pruebas de la actividad Kotlin real con dobles del framework Android**, incluyendo arranque sin estado, accesos antiguos, descarte de extras y contención OEM.
- **Todas las fuentes Kotlin actuales compiladas: salida 0**, usando JDK/JARs Android/Expo/React ya instalados y el validador JVM local. Sin Gradle, instalación de SDK, build APK, credenciales ni peticiones reales de negocio.
- Validadores: `src/branding/tests/validate.cjs` y `modules/company-branding/tests/validate-native.cjs --all-sources`. Informes temporales de esta revisión: `qualitzer-branding-validation-IZepjw/report.json` y `qualitzer-branding-native-RQX9HG/report.json`.
- La nueva apertura se probó en la APK 1.0.3 después de detener el proceso del emulador: llegó al login normal sin el aviso. La confirmación automática del pin no se probó con una sesión real ni en teléfono físico. Evidencia de la revisión: [informe nativo](../artifacts/logs/native-release-1.0.3/compact-native/SUMMARY.md).
- Pendiente en teléfonos/lanzadores autorizados: cancelar/confirmar pin, matar proceso, reabrir pin antiguo, logout/cambio de empresa, logo inválido/HTTPS y lanzador no compatible, incluyendo versiones Android anteriores compatibles.
- Para recibir la marca de la sucursal seleccionada se conserva el gateway 1.0.1 de la entrega anterior. Las capturas recibidas ya muestran esa marca; no se desplegó ni se generó un nuevo gateway para 1.0.3: [ACTUALIZACION-1.0.3.md](ACTUALIZACION-1.0.3.md).

## Archivos de la revisión 2026-09-11

Runtime (9 archivos):

- [App.tsx](../App.tsx): únicamente cableado de branding.
- [companyBrandingContext.ts](../src/branding/companyBrandingContext.ts): elegibilidad con estado existente.
- [CompanyBrandingController.ts](../src/branding/CompanyBrandingController.ts): deduplicación automática/manual.
- [contracts.ts](../src/branding/contracts.ts): método automático opcional y resultado skipped.
- [useCompanyBranding.ts](../src/branding/useCompanyBranding.ts): solicitud tras readiness.
- [CompanyShortcutActivity.kt](../modules/company-branding/android/src/main/java/expo/modules/companybranding/CompanyShortcutActivity.kt): apertura normal compatible.
- [CompanyPinRequests.kt](../modules/company-branding/android/src/main/java/expo/modules/companybranding/CompanyPinRequests.kt): marcador atómico sin secretos.
- [CompanyBrandingState.kt](../modules/company-branding/android/src/main/java/expo/modules/companybranding/CompanyBrandingState.kt): reutilización del pin y control persistente de solicitud.
- [CompanyBrandingModule.kt](../modules/company-branding/android/src/main/java/expo/modules/companybranding/CompanyBrandingModule.kt): puente automático separado del manual.

Tests/validadores (11 archivos):

- [company-branding.test.ts](../tests/company-branding.test.ts).
- [stability.test.ts](../src/branding/tests/stability.test.ts).
- [context.test.ts](../src/branding/tests/context.test.ts).
- [validate.cjs](../src/branding/tests/validate.cjs).
- [NativeRegression.kt](../modules/company-branding/tests/NativeRegression.kt).
- [validate-native.cjs](../modules/company-branding/tests/validate-native.cjs).
- [Activity.kt](../modules/company-branding/tests/shortcut/Activity.kt).
- [Intent.kt](../modules/company-branding/tests/shortcut/Intent.kt).
- [Bundle.kt](../modules/company-branding/tests/shortcut/Bundle.kt).
- [CompanyBrandingState.kt de prueba](../modules/company-branding/tests/shortcut/CompanyBrandingState.kt).
- [ShortcutRegression.kt](../modules/company-branding/tests/shortcut/ShortcutRegression.kt).

Documentación (2 archivos): este documento y [README del módulo](../modules/company-branding/README.md).

Referencias consultadas: [SDK 57](https://docs.expo.dev/versions/v57.0.0/), [módulo local](https://docs.expo.dev/modules/get-started/), [autolinking](https://docs.expo.dev/modules/autolinking/), [lifecycle Android](https://docs.expo.dev/modules/android-lifecycle-listeners/), [ShortcutManager](https://developer.android.com/reference/android/content/pm/ShortcutManager), [TaskDescription.Builder](https://developer.android.com/reference/android/app/ActivityManager.TaskDescription.Builder).