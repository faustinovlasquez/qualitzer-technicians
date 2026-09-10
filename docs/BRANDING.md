# Distribuciones de Qualitzer Field por empresa

## Marca dentro de la app

La interfaz adapta automáticamente nombre y logo al branding válido que la pasarela obtiene de `/companies/branding` para la empresa coincidente/autenticada. Antes de comprobar las credenciales no se presupone una empresa. Si hay varias coincidencias, el selector sólo muestra esas empresas; si falta el nombre o el logo, se conserva el nombre configurado y/o la imagen genérica. El branding es presentación, no autorización ni configuración de destinos.

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

La única empresa actualmente configurada es `grupo-eliseo-local`, un entorno de **desarrollo local**, no un destino de producción. El comando consulta el endpoint real de branding de ese tenant y requiere que su backend esté disponible; **no necesita usuario, contraseña ni sesión**. El último dato conocido devuelve **Grupoeliseo**, sin logo (`HasLogo: false`). Mientras siga así, el script generará el JSON con ese nombre y conservará los iconos genéricos existentes, emitiendo `BRANDING_LOGO_MISSING`. No inventa ni dibuja un logo corporativo. Un fallo HTTP, JSON inválido o un nombre inválido detiene la preparación, en lugar de simular una consulta satisfactoria.

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

## Estado de verificación

Se ejecutó el preparador para `grupo-eliseo-local`: nombre **Grupoeliseo**, sin logo disponible, conservando los iconos genéricos. Se verificó la resolución de nombre e identificadores Android/iOS mediante Expo config. La versión genérica fue exportada para Android, iOS y web. **No hay APK/IPA compilado ni firmado.** Antes de distribuir, revisar las salidas reales de la empresa y validar la aplicación firmada en dispositivos físicos.

Referencia: [configuración de Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/config/app/) y [resolución de configuración dinámica](https://docs.expo.dev/workflow/configuration/).