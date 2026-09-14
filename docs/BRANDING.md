# Marca de Qualitzer técnicos y distribuciones por empresa

## Actualización 1.0.3

La entrega vigente es **1.0.3 / código 4**, con la misma firma y assets base. El acceso empresarial ya abre sin el aviso previo y se solicita automáticamente una vez tras la sesión verificada, siempre con confirmación Android. No modifica el icono principal ni cambia de empresa al abrir. La sección 1.0.2 siguiente conserva el contexto de la marca de sucursal. Detalles y límites: [ACTUALIZACION-1.0.3.md](ACTUALIZACION-1.0.3.md).

## Entrega integrada 1.0.2

El APK final se llama **Qualitzer técnicos**, versión **1.0.2**, código Android **3**. Usa los PNG Qualitzer descritos abajo; conserva `com.qualitzer.field` y el certificado de las versiones 1.0.0/1.0.1 para instalar mediante **Actualizar**, sin desinstalar. Se verificaron el nombre nativo, 15 recursos de iconos empaquetados, la firma y el bundle.

Dentro de la app se muestra el nombre/logo configurado por empresa. Para el escritorio Android, **Mi perfil → Añadir empresa a pantalla de inicio** solicita un acceso empresarial con confirmación del sistema. Es un acceso directo a la misma app, no un cambio automático del icono principal ni una segunda instalación. Más detalles en [ANDROID-COMPANY-BRANDING.md](ANDROID-COMPANY-BRANDING.md).

Consulta pública del servidor el 10-09-2026: Heavytech devuelve un PNG base64; Grupoeliseo devuelve nombre pero `logo: null`. Esa lectura general **no determina** si una sucursal tiene logo. El gateway 1.0.1 empaquetado consulta el detalle protegido de la sucursal elegida y actualiza el nombre/logo de presentación. Su despliegue sigue pendiente; el APK 1.0.2 incorpora también descarga HTTPS segura para la marca del acceso Android.

La compilación conserva la corrección del reloj al seleccionar empresa y añade la del cierre nativo de Agenda, verificada en emulador Android API 36. No se realizó login ni prueba en el teléfono físico. Resumen y pasos del servidor en [ACTUALIZACION-1.0.2.md](ACTUALIZACION-1.0.2.md). Las secciones históricas sobre preparadores por empresa no describen un renombrado dinámico del launcher.

## Marca base y assets reproducibles (2026-09-10)

La identidad base de la UI es **Qualitzer técnicos**. `Brand` muestra la Q original y ese nombre antes del login; cuando recibe `Tenant`, usa su nombre y logo configurados, sin etiquetas `FIELD`. Un logo ausente, inválido o que falla al cargar vuelve a la Q local, no a una herramienta ni a una empresa fija. El estado de fallo se reinicia al cambiar URI o empresa, incluso en una secuencia A → B → A. El nombre tiene una sola línea con elipsis y su valor completo permanece en la etiqueta accesible. Los parámetros anteriores `showTag` y `singleLine` se conservan por compatibilidad de llamadas, pero ya no habilitan etiquetas ni varias líneas.

- Fuente real, frontend **sólo lectura**: `C:/Users/faust/Desktop/www/Qualitzer2.0-Frontend/public/icon-512x512.png`.
- Copia exacta incorporada: [../assets/qualitzer-source.png](../assets/qualitzer-source.png), 512 × 512 RGBA.
- SHA-256 fuente/copia: `c5e47a2c49a8fb40d4f57500a2c9ad7aff077cf9d3b7624d19972596d6a1f309`.
- Se inspeccionaron los iconos públicos de 16/32/192/256/384/512 y las variantes compartidas: la Q independiente de mayor resolución encontrada es la pública de 512. La versión simplificada tiene 88 × 88; los logotipos con texto no aportan una Q mayor. El original ya es rasterizado: ampliarlo no crea detalle vectorial.
- Generador: [../scripts/generate-qualitzer-brand.cjs](../scripts/generate-qualitzer-brand.cjs), usa el `sharp` instalado (verificado con 0.35.4), sin dependencias nuevas ni acceso a red. Una ejecución sin argumentos regenera desde la copia móvil. `--source` permite reimportar el original y exige el SHA-256 aprobado antes de escribir.
- Sólo se recortan márgenes transparentes (rectángulo original: x=16, y=37, ancho=484, alto=430); se conservan colores, forma y proporciones. No se redibuja el logo. No se eliminan los assets anteriores.

| Recurso | Tamaño | Tratamiento | SHA-256 |
| --- | --- | --- | --- |
| [../assets/qualitzer-icon.png](../assets/qualitzer-icon.png) | 1024 × 1024 | RGB opaco, blanco, Q centrada en 800 × 800 | `0dc9f8a9873cef42819f2f6a34f0dbf0b76e51c5c540ff7ec5eb25395ebb452c` |
| [../assets/qualitzer-adaptive.png](../assets/qualitzer-adaptive.png) | 1024 × 1024 | RGBA transparente, Q dentro de 560 × 560; píxeles dentro del círculo seguro 66/108 | `7c553dffa5c85a6f2f0c63c52e82a261f8dadf1d51f12916c45f46f55e42b9de` |
| [../assets/qualitzer-logo.png](../assets/qualitzer-logo.png) | 512 × 512 | RGBA, Q dentro de 480 × 480, UI con `contain` | `c16fdd1b6a34a2708c69b733c7af8ba27a6bd1864de50c8009c590384c8b73ab` |
| [../assets/qualitzer-favicon.png](../assets/qualitzer-favicon.png) | 64 × 64 | RGBA, Q dentro de 60 × 60 | `e10084e8d8ff909312c07e32e0e7ac724bae9c6370a2bb0505a52adcaa232537` |

### Integración y límites

La UI reutiliza [../src/domain/branding.ts](../src/domain/branding.ts) (`QUALITZER_APP_NAME`, `brandName`, `safeBrandLogo`) y [../src/ui/components.tsx](../src/ui/components.tsx) (`Brand`, logo interno con clave por empresa/URI). La validación local de URL mantiene el comportamiento anterior; la política restrictiva del branding recibido sigue perteneciendo al servidor. No se modifican autenticación, sesión, identidad offline ni destinos.

El servidor consulta `/companies/branding` para la marca general, con caché por tenant. Desde el gateway 1.0.1, `/api/auth/me?companyBranchId=N` valida la pertenencia fresca a N y consulta `/branches/N` sin caché de sucursal; usa su nombre/logo válidos sin cambiar la identidad del `Tenant`. No depende de que el listado `Branch` incluya logo. Mientras se espera `/me`, `Brand` muestra la marca recibida; un logo ausente o rechazado conserva el general, nunca el de otra sucursal. Contrato: [GATEWAY-BRANCH-BRANDING.md](GATEWAY-BRANCH-BRANDING.md).

El cambio de nombre/versión en la configuración Expo y el cableado de iconos nativos/favicon quedan a cargo de la integración principal/nativa. Estos assets no cambian por sí solos el launcher de un APK instalado. Tampoco se modifica [../App.tsx](../App.tsx), [../src/screens/ProfileScreen.tsx](../src/screens/ProfileScreen.tsx), el selector de empresas ni el hook de autenticación. El login conserva su `SafeAreaView`, scroll y controles; usa la nueva marca compartida sin refactorizar el formulario.

Pruebas específicas: [../tests/branding.test.ts](../tests/branding.test.ts) y [../tests/branding-assets.test.cjs](../tests/branding-assets.test.cjs). Cubren identidad, URLs, ausencia de FIELD, elipsis, fallo/reinicio del logo, copia SHA-256, regeneración exacta, no destrucción de assets y círculo seguro adaptativo. No equivalen a instalación o validación física Android/iOS.

Validación ejecutada: **9/9 pruebas**, TypeScript del grafo propio incluyendo la prueba TS con tipos Node explícitos **0 errores** y smoke [../tests/e2e/branding-smoke.cjs](../tests/e2e/branding-smoke.cjs) **PASS** en 320/360/390/1280 px. Este último monta `Brand` e `IconButton` reales con React Native Web, sustituye sólo los glifos decorativos, bloquea toda red y comprueba una sola identidad, elipsis, targets ≥44 px y recuperación de `Image` tras URL rota/válida/rota/válida. Capturas e informe de esta ejecución: carpeta temporal `qualitzer-brand-ui-PuA0aJ`; se inspeccionaron visualmente las capturas a 320 px y los PNG generados. **No es una prueba del header completo ni del login/safe area en dispositivo**: Metro no estaba disponible en la comprobación inicial y no se inició ni reinició ningún servicio. Sin build, lint ni pruebas backend/frontend globales.

## Marca dentro de la app

La interfaz adapta automáticamente nombre y logo al branding válido de la empresa autenticada y, con gateway 1.0.1, al detalle de la sucursal autorizada seleccionada. Antes de comprobar las credenciales no se presupone una empresa. Si hay varias coincidencias, el selector sólo muestra esas empresas; si falta el nombre o el logo, se conserva el nombre configurado y/o la imagen genérica. El branding es presentación, no autorización ni configuración de destinos.

Esto es independiente de la marca de una distribución instalada: no requiere recompilar para mostrar los datos internos de la empresa, pero **no modifica el icono ni el nombre nativos del launcher**.

## Qué cambia y qué no

El nombre bajo el icono y el icono del launcher de una app instalada son recursos nativos fijados **al construir el binario**. Este mecanismo no los cambia según el usuario que inicia sesión. Expo Go sigue siendo Expo Go: puede mostrar metadatos del proyecto, pero no se convierte en una aplicación instalada con otro nombre e icono. Una actualización OTA tampoco sustituye estos recursos nativos.

El desarrollador prepara una distribución por empresa, revisa sus recursos y después construye e instala su APK/AAB o IPA con las herramientas y credenciales correspondientes. Cambiar la marca requiere preparar otro build e instalarlo. Preparar los recursos **no compila, no firma, no instala ni sube nada a EAS o a las tiendas**.

La configuración dinámica de [../app.config.ts](../app.config.ts) recibe la configuración estática original mediante `ConfigContext.config`; no reescribe la configuración base. Sin `QUALITZER_BRAND_FILE` devuelve el objeto original sin cambios. Con la variable definida sólo sustituye nombre, slug, iconos nativos, identificadores Android/iOS y añade `extra.distributionTenantId`, conservando las demás opciones.

`distributionTenantId` es metadato público de distribución, **no una autorización ni un tenant obligatorio para el login**. No contiene dominios, rutas del backend ni credenciales. El acceso empieza por usuario/contraseña y sigue sujeto a la allowlist y a sus coincidencias verificadas: una distribución con marca puede acceder a otras empresas autorizadas. No se debe usar su marca para deducir permisos.

## Preparación por el desarrollador

El preparador es [../scripts/prepare-company-brand.cjs](../scripts/prepare-company-brand.cjs). Requiere las dependencias ya instaladas, incluido `sharp`, y Node 22.13 o superior. En Windows este proyecto dispone de su propio Node. Los siguientes comandos se ejecutan desde la raíz de Qualitzer-Mobile; son instrucciones manuales del desarrollador, **no pasos ejecutados por esta actualización documental ni necesarios para el login diario**.

Ayuda, sin llamadas HTTP ni generación de archivos:

```powershell
node scripts/prepare-company-brand.cjs --help
```

Preparar la empresa local ya existente en la allowlist:

```powershell
.\node_modules\node\bin\node.exe scripts/prepare-company-brand.cjs --tenant grupo-eliseo-local
```

El ejemplo histórico `grupo-eliseo-local` corresponde a **desarrollo local**, no a un destino de producción ni al catálogo remoto actual. Este preparador usa la allowlist local legacy, a diferencia del descubrimiento de empresas en runtime. El comando consulta el endpoint real de branding de ese registro y requiere que su backend esté disponible; **no necesita usuario, contraseña ni sesión**. La comprobación histórica devolvió **Grupoeliseo**, sin logo (`HasLogo: false`). Con una respuesta sin logo, el script genera el JSON con ese nombre y conserva los iconos genéricos existentes, emitiendo `BRANDING_LOGO_MISSING`. No inventa ni dibuja un logo corporativo. Un fallo HTTP, JSON inválido o un nombre inválido detiene la preparación, en lugar de simular una consulta satisfactoria.

Si un administrador dispone de un logo revisado, puede proporcionarlo explícitamente. Sustituir la ruta siguiente por un archivo real:

```powershell
.\node_modules\node\bin\node.exe scripts/prepare-company-brand.cjs --tenant grupo-eliseo-local --logo "C:\Branding\logo-aprobado.png"
```

`--logo` tiene prioridad sobre el logo de la respuesta; el nombre sigue procediendo del backend configurado. Las rutas relativas de este argumento se resuelven desde el directorio actual. No se admiten URLs ni rutas UNC.

La salida es un JSON por tenant dentro del directorio de configuración. Si hay un logo válido, genera dos PNG bajo el subdirectorio de branding del tenant: icono de 1024 × 1024 con fondo blanco y sin transparencia, y foreground adaptativo de 1024 × 1024 con el logo centrado en 640 × 640 y margen transparente. Se decodifican los píxeles con `sharp`, se normalizan orientación/color y se eliminan metadatos; no se copia ciegamente el archivo recibido. Revisar visualmente el resultado y las máscaras del launcher antes de distribuir.

Cada ejecución reemplaza sólo sus salidas generadas. No modifica la allowlist, el código de aplicación, el gateway, dependencias ni variables persistentes. Sin logo no crea PNG corporativos ni referencia salidas antiguas: vuelve a los iconos genéricos.

## Contrato y selección del build

El [../config/build-brand.example.json](../config/build-brand.example.json) incluido es únicamente una plantilla de distribución, no la salida generada de la empresa local: `example-local` no registra una empresa y `example.local` es un identificador ilustrativo, no un backend ni un dominio de producción. El preparador sólo acepta un tenant habilitado en la allowlist administrada del servidor; la configuración de Expo valida el JSON de distribución, sin leer ni incorporar esa allowlist.

| Campo | Validación |
| --- | --- |
| `tenantId` | De 1 a 100 caracteres, minúsculas/dígitos, guion o guion bajo; empieza por letra o dígito. Se conserva íntegro en `distributionTenantId`. |
| `name` | De 1 a 120 caracteres, sin controles ni espacios exteriores. Se usa como nombre nativo. |
| `androidPackage` | Al menos dos segmentos separados por puntos; cada segmento empieza por minúscula y continúa con letras, dígitos o guion bajo. Máximo 255 caracteres. |
| `iosBundleIdentifier` | Al menos dos segmentos separados por puntos; cada segmento empieza por letra y continúa con letras, dígitos o guion. Máximo 255 caracteres. |
| `iconPath` | PNG existente, con ruta relativa segura dentro de assets/branding, o el icono genérico existente del proyecto. |
| `adaptiveIconPath` | Opcional. Mismas restricciones; admite el foreground genérico existente. Si se omite, utiliza `iconPath` como foreground. Conviene generar el recurso con margen. |

Se rechazan claves adicionales, rutas absolutas de imágenes, URLs, segmentos `..`, separadores Windows en las rutas de imágenes y enlaces simbólicos que desvíen el archivo. Los únicos recursos fuera de assets/branding permitidos son los dos iconos genéricos existentes, cada uno en su campo correspondiente. El JSON local no puede superar 64 KiB. Una variable definida pero vacía, un JSON incorrecto o un recurso ausente hacen fallar la configuración; no se aplica una marca parcial ni se vuelve silenciosamente al build genérico.

El preparador obtiene ambos identificadores con el prefijo `com.qualitzer.field.` y una etiqueta formada por `t`, los primeros 40 caracteres alfanuméricos del id y 12 caracteres hexadecimales de SHA-256 del id completo. Así empiezan por letra, no contienen guiones ilegales en Android y se distinguen ids que sólo difieren por separadores. El slug de Expo lleva el prefijo `qualitzer-field-` y normaliza guiones/guiones bajos del tenant. Si dos tenants normalizan al mismo slug, deben usar proyectos/cuentas de Expo apropiados; los identificadores de aplicación siguen siendo distintos.

Los identificadores escritos en el JSON se validan y se usan **exactamente**, sin corregirlos. Revisarlos y reservarlos antes de la primera distribución. Una vez publicada una app, mantener sus identificadores y su firma para futuras actualizaciones; cambiar el identificador crea otra app y no migra sesiones ni datos locales. Los identificadores generados no acreditan propiedad de marca o disponibilidad en las tiendas.

Seleccionar la configuración y comprobar su resolución, sin construir ni subir la app:

```powershell
$env:QUALITZER_BRAND_FILE = "config/build-brand.grupo-eliseo-local.json"
.\node_modules\node\bin\node.exe node_modules/expo/bin/cli config --type public
```

Las rutas relativas de `QUALITZER_BRAND_FILE` y de las imágenes se resuelven desde la raíz del proyecto, no desde el directorio del JSON. No se consulta la red al resolver la configuración. Para regresar a la configuración original:

```powershell
Remove-Item Env:QUALITZER_BRAND_FILE -ErrorAction SilentlyContinue
.\node_modules\node\bin\node.exe node_modules/expo/bin/cli config --type public
```

En macOS/Linux, con Node compatible, la comprobación equivalente es:

```sh
QUALITZER_BRAND_FILE=config/build-brand.grupo-eliseo-local.json node node_modules/expo/bin/cli config --type public
```

No se necesita editar código ni la configuración base para preparar otra empresa ya habilitada: ejecutar el preparador con su id y seleccionar su JSON. No reutilizar la configuración local como supuesto destino productivo.

## EAS y distribución posterior

- Preparar y revisar los recursos **localmente**, antes del build remoto. No ejecutar el preparador en EAS: la allowlist es administrativa y el backend local no será accesible allí.
- En el entorno EAS elegido para el build, definir `QUALITZER_BRAND_FILE` como variable de texto visible para la evaluación local y remota de la configuración. Usar el mismo valor relativo que en la terminal; no usar visibilidad `secret`, una ruta absoluta de Windows ni el prefijo `EXPO_PUBLIC_`.
- Asegurar que el perfil de build seleccione ese entorno. Las variables de una terminal local no se transfieren automáticamente al worker. Mantener entornos/proyectos separados o una selección explícita por empresa para no construir con otra marca accidentalmente.
- El JSON y sus PNG deben estar disponibles tanto al resolver la configuración localmente como en el archivo enviado al worker. Si la integración ignora los JSON generados mediante el patrón `config/build-brand.*.json` con excepción del ejemplo, no asumir que EAS los incluye: configurar expresamente su inclusión en el archivo de subida o su aprovisionamiento previo en CI. No subir la allowlist administrativa, secretos ni archivos de entorno. Este cambio limitado no modifica reglas de Git/EAS.
- Gestionar el proyecto EAS, el slug y su `projectId` por distribución. La configuración conserva cualquier `extra.eas` existente: **no crea ni enlaza proyectos EAS automáticamente**. Un `projectId` enlazado a otro slug debe resolverse antes del build.
- Los perfiles de build existentes no son una app ya compilada o firmada. La construcción, firma, instalación y publicación requieren una acción posterior del desarrollador y sus credenciales gestionadas fuera de este script. No proporcionar contraseñas o claves al preparador.
- Se conservan permisos, plugins, versión, esquema de enlaces y opciones web originales. El esquema heredado no separa deep links entre varias marcas instaladas: si se utilizan, diseñar y configurar su aislamiento en una tarea independiente.

## Límites de seguridad del preparador

- Lee únicamente la allowlist local del proyecto. No acepta backend, Origin ni tenant arbitrarios por URL o variables del cliente; no carga archivos de entorno ni importa módulos del gateway o de la app.
- Envía un único `GET` al sufijo fijo `/companies/branding` del backend configurado y el `Origin` exacto del mismo registro. No envía autorización, cookies ni credenciales de usuario. El administrador sigue siendo responsable de los destinos de esa allowlist; sólo se permite HTTP en desarrollo.
- Rechaza redirecciones sin seguirlas. El límite de 20 segundos cubre conexión, cabeceras y lectura del cuerpo. Comprueba el MIME JSON y limita la respuesta, también durante streaming, a 1 MiB (1 048 576 bytes).
- El logo sólo puede ser un data URL base64 PNG/JPEG/WebP de la respuesta, o un archivo local indicado expresamente por el administrador. **No descarga URLs de logos**, ni siquiera del mismo host: una URL HTTP(S) produce advertencia e icono genérico, evitando peticiones a destinos elegidos por la respuesta del backend.
- Cada logo tiene un límite de 1 MiB decodificado. El límite de 1 MiB de JSON también incluye el base64, por lo que un logo embebido cercano a 1 MiB excederá el tamaño de respuesta permitido.
- Comprueba MIME declarado, firma binaria y decodificación completa con `sharp`. Rechaza SVG, formatos distintos, base64 no canónico, discrepancias de MIME, imágenes corruptas, animaciones y más de 16 megapíxeles (16 × 1024 × 1024). No recurre al icono genérico ante una imagen corrupta: falla para que el administrador la revise.
- Las escrituras se limitan a salidas locales por tenant, rechazan directorios/archivos desviados mediante enlaces y sustituyen cada archivo mediante un temporal. La preparación no debe ejecutarse simultáneamente para el mismo tenant ni mientras se construye su distribución.

## Verificación histórica del preparador por empresa

Durante la preparación original se ejecutó el preparador para `grupo-eliseo-local`: nombre **Grupoeliseo**, sin logo disponible, conservando los iconos genéricos. Se verificó la resolución de nombre e identificadores Android/iOS mediante Expo config y se exportó la versión genérica. Esta sección histórica no acredita el branding del catálogo remoto actual ni el estado de APK posteriores. La generación de assets base descrita arriba no compila ni firma un nuevo APK/IPA. Antes de distribuir, revisar las salidas reales y validar la aplicación firmada en dispositivos físicos.

Referencia: [configuración de Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/config/app/) y [resolución de configuración dinámica](https://docs.expo.dev/workflow/configuration/).