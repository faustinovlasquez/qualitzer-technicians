# Toolchain local Android y APK standalone

Preparación original verificada el 2026-09-10. La sección de herramientas documenta esa preparación; para generar y verificar la entrega firmada se usa ahora el flujo siguiente.

## Entrega verificada el 2026-09-10

- APK: `artifacts/qualitzer-field-1.0.0-android.apk`, **49.303.920 bytes (47,02 MiB)**.
- SHA-256: `66f98cc0d8329f56bdfdcd1ed280da7362b9d090c8c975621c51f60610808c04`.
- Certificado público SHA-256: `06da359352b67f02805c065a4f7054fc863cc606221dfe054462f261da32b510`, RSA 3072, `CN=Qualitzer Field,O=Qualitzer`; firma APK v2 válida y distinta de debug.
- `com.qualitzer.field`, versión `1.0.0`, versionCode `1`, Release, `DEBUG=false`, minSdk **24**, targetSdk **36**, ARM64 y ARMv7.
- Bytecode Hermes embebido: **3.445.656 bytes**. Configuración del APK: standalone activado, URL pública `/mobile` correcta y actualizaciones remotas deshabilitadas. Alineación ZIP de 16 KiB verificada.
- Gradle completó `:app:assembleRelease` con código **0** en **680 segundos (11 min 20 s)**. Logs de compilación: `artifacts/logs/2026-09-10T17-17-27-133Z/`; el bundle de Metro se generó durante el build en unos **29 s**, con 1.145 módulos y 19 assets, sin usar el servidor Metro de desarrollo para ejecutar el APK.
- La primera inspección esperaba el nombre anterior `libhermes.so`; se corrigió únicamente el verificador a `libhermesvm.so` de RN 0.86. El APK nativo ya compilado se verificó nuevamente sin recompilar: `artifacts/logs/2026-09-10T17-32-14-020Z/`. La reaplicación de ACL también se corrigió para modificar solo DACL y no requerir privilegios de auditoría.
- Informes: `artifacts/release-verification.json` y `artifacts/final-audit.json`. Auditoría final: ACL protegidas del usuario y SYSTEM en carpeta/credenciales/keystore, checksum recalculado idéntico, contraseña de firma ausente de los 20 artefactos/logs inspeccionados y ausencia de fuentes propias de servidor/tests/scripts en el source map de producción (1.152 fuentes).
- Avisos no bloqueantes: APIs obsoletas de dependencias, metadatos de manifest y límite de metaspace de 512 MiB del daemon. No se modificaron dependencias para silenciarlos. El proceso de release incluye las comprobaciones nativas `lintVital` de Gradle; no se ejecutaron tests ni validaciones globales de backend/frontend.
- **Pendientes:** despliegue manual del backend `/mobile`, instalación y prueba en teléfono físico, autenticación nativa y push/FCM si se habilita. No se instaló automáticamente en ningún dispositivo ni se usaron credenciales reales.

## Compilar el APK firmado

Desde la raíz del proyecto, ejecutar `scripts/android/Build-Standalone.ps1` en PowerShell. Por defecto compila Release para `arm64-v8a,armeabi-v7a`; `-Architectures arm64-v8a` limita la compilación a ARM64. `-PrebuildOnly` solo genera Android y `-SkipPrebuild` permite reanudar una compilación nativa sin regenerarlo.

`-VerifyOnly` vuelve a verificar y copiar el APK nativo existente, sin regenerar Android, recompilar ni crear una identidad de firma. No prueba que ese APK corresponda a cambios de fuentes posteriores: usar el flujo completo para entregar cambios nuevos. La verificación exige el mismo fingerprint que la clave local, alineación ZIP de 16 KiB y las bibliotecas reales de RN 0.86/Hermes (`libhermesvm.so`, `libhermestooling.so`, `libreactnative.so`).

- El wrapper activa la toolchain local y protege `.data/android-signing` con una ACL exacta para el usuario actual y SYSTEM.
- El runner crea una identidad RSA 3072 dedicada con alias `qualitzer-field`, certificado `CN=Qualitzer Field,O=Qualitzer` y almacén PKCS12. Contraseña criptográficamente aleatoria, generada dentro del proceso; no se solicita ni se escribe en comandos, fuentes o logs. Clave y credenciales se conservan localmente en la carpeta privada ignorada y nunca se sobrescriben. Un estado incompleto detiene el build.
- **Conservar una copia segura de toda la carpeta privada de firma.** Sin esa identidad no se puede actualizar la misma instalación conservando sus datos. No compartirla junto con el APK ni subirla al repositorio. No es una clave de Play Console ni de Expo.
- Los procesos de Expo/Gradle reciben un entorno limitado a variables de sistema/toolchain, `NODE_ENV=production`, `EXPO_NO_DOTENV=1`, `EAS_BUILD_PROFILE=standalone-apk`, `EXPO_PUBLIC_STANDALONE=true` y `EXPO_PUBLIC_GATEWAY_URL=https://api-demos-qz-v2.qualitzer.com/mobile`. No heredan variables de backend, branding local ni archivos `.env` de desarrollo.
- Prebuild usa `--platform android --no-install`, sin `--clean`. No instala paquetes ni inicializa otro proyecto.
- Gradle recibe `release-signing.gradle` mediante `--init-script`. El callback `androidComponents.finalizeDsl` sustituye la firma debug de la plantilla por `qualitzerRelease` y fuerza `debuggable=false`. Las contraseñas solo llegan al proceso hijo por entorno; no hay propiedades privadas dentro de Android ni fuentes versionadas. **No distribuir builds realizados directamente con la firma predeterminada de la plantilla.**
- El runner rechaza `expo-dev-client`, valida configuración embebida, firma APK v2 y certificado no-debug, identidad de paquete, ABIs, librerías Hermes, cabecera de bytecode, URL en el bundle, flag standalone y actualizaciones remotas deshabilitadas. Inspecciona el manifest y calcula SHA-256.
- Entrega: `artifacts/qualitzer-field-1.0.0-android.apk`, checksum adyacente y `artifacts/release-verification.json`. Logs y códigos de salida de cada fase: `artifacts/logs/<fecha>/`. El informe solo se produce tras superar las verificaciones; comprobar su fecha y hash antes de usar un artefacto de una ejecución anterior.
- No instala en dispositivos, no inicia sesión, no ejecuta tests/lint globales, no despliega el backend y no detiene Metro ni la pasarela de desarrollo. Una URL remota pendiente de despliegue no bloquea el build, pero sí impide dar por probado el acceso real.

La inspección estática no sustituye una prueba en un teléfono. El APK contiene su JavaScript y no requiere Expo Go, Metro ni PC; las operaciones remotas requieren que se despliegue correctamente el servidor `/mobile`. Las credenciales de push/FCM no se inventan ni configuran durante este flujo.

## Rutas y versiones exactas

Raíz local: `C:\Users\faust\AppData\Local\QualitzerAndroid`.

| Herramienta | Versión | Ruta |
| --- | --- | --- |
| Node del proyecto | 22.23.2 | `C:\Users\faust\Desktop\www\Qualitzer-Mobile\node_modules\node\bin\node.exe` |
| Java / javac Temurin | 17.0.20.1+1 | `C:\Users\faust\AppData\Local\QualitzerAndroid\jdk\jdk-17.0.20.1+1\bin` |
| Gradle | 9.3.1 | `C:\Users\faust\AppData\Local\QualitzerAndroid\gradle\gradle-9.3.1\bin\gradle.bat` |
| sdkmanager operativo | 19.0, archivo 13114758 | `C:\Users\faust\AppData\Local\QualitzerAndroid\sdk\cmdline-tools\19.0\bin\sdkmanager.bat` |
| Android SDK | Platform 36, revisión 2 | `C:\Users\faust\AppData\Local\QualitzerAndroid\sdk\platforms\android-36` |
| Build Tools | 36.0.0 | `C:\Users\faust\AppData\Local\QualitzerAndroid\sdk\build-tools\36.0.0` |
| Platform Tools / adb | 37.0.1-15733141 / 1.0.41 | `C:\Users\faust\AppData\Local\QualitzerAndroid\sdk\platform-tools\adb.exe` |
| NDK r27b | 27.1.12297006 | `C:\Users\faust\AppData\Local\QualitzerAndroid\sdk\ndk\27.1.12297006` |
| Clang / LLD | 18.0.2 | `C:\Users\faust\AppData\Local\QualitzerAndroid\sdk\ndk\27.1.12297006\toolchains\llvm\prebuilt\windows-x86_64\bin` |
| CMake | 3.22.1, Ninja 1.10.2 | `C:\Users\faust\AppData\Local\QualitzerAndroid\sdk\cmake\3.22.1\bin` |
| CMake adicional | 3.30.5 | `C:\Users\faust\AppData\Local\QualitzerAndroid\sdk\cmake\3.30.5\bin` |

Java, SDK 36, Build Tools y adb se reutilizaron. Se añadieron Gradle, cmdline-tools 19.0, NDK y CMake. Todas las instalaciones y cachés están en el perfil del usuario, sin administrador ni variables persistentes. `Use-Toolchain.ps1` configura `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `ANDROID_USER_HOME`, `GRADLE_USER_HOME` y PATH solo para el proceso actual.

## Requisitos confirmados en las fuentes instaladas

- Documentación exacta: https://docs.expo.dev/versions/v57.0.0/ (Expo 57, RN 0.86, Node mínimo 22.13, SDK/target 36).
- `node_modules/react-native/ReactAndroid/gradle.properties`: RN **0.86.3**.
- `node_modules/react-native/gradle/libs.versions.toml`: **minSdk 24**, **compileSdk 36**, **targetSdk 36**, **Build Tools 36.0.0**, **NDK 27.1.12297006**, **AGP 8.12.0**, Kotlin **2.1.20**.
- El plugin de autolinking de Expo carga ese catálogo de React Native.
- La plantilla Android dentro de `node_modules/expo/template.tgz` fija **Gradle 9.3.1**. Se leyó con `tar -xOf`, sin generar el proyecto nativo.
- AGP 8.12 requiere JDK **17** y Gradle mínimo **8.13**: https://developer.android.com/build/releases/past-releases/agp-8-12-0-release-notes.
- `node_modules/react-native/ReactAndroid/build.gradle.kts` fija CMake **3.30.5** para compilar ReactAndroid desde fuentes. También se instaló **3.22.1** para los módulos que usan el CMake predeterminado de AGP; no se modificó la selección de CMake de la app.
- Gradle 9.3.1 arrancó con Java 17 y devolvió código 0. Esto no reemplaza una futura compilación ni verifica todavía todos los plugins nativos juntos.

## Integridad de las descargas

Metadatos oficiales: API HTTPS de Adoptium, `https://dl.google.com/android/repository/repository2-3.xml` y `https://services.gradle.org/distributions/gradle-9.3.1-bin.zip.sha256`.

| Archivo en la carpeta local `downloads` | SHA-256 calculado |
| --- | --- |
| `OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip` | `e53a79c3c3d86865bd7e787903884331068e71321714ffd44f145785affc7cb0` |
| `commandlinetools-win-13114758_latest.zip` | `98b565cb657b012dae6794cefc0f66ae1efb4690c699b78a614b4a6a3505b003` |
| `gradle-9.3.1-bin.zip` | `b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06` |
| `android-ndk-r27b-windows.zip` | `6fa1fa6e95191eb374d389018b6bbdc9adb835f62f1d2b717001f65e0df8e351` |
| `commandlinetools-win-16111833_latest.zip`, anterior conservado | `e5885e2e59038c0778a85fc19f01de7ce7c567c105553f7617b936b1e0e87b2b` |

Java y Gradle se contrastaron con SHA-256 oficial. Google publicó SHA-1 en el catálogo para los otros archivos, y se verificaron antes de extraer:

- cmdline-tools 19.0: `54a582f3bf73e04253602f2d1c80bd5868aac115`.
- NDK r27b: `3bb7efc850cd0af7707854b7e0d5c3b6a7153703`.
- cmdline-tools anterior: `57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d`.

Los SHA-256 de estos tres ZIP son fingerprints locales, no una segunda comparación contra SHA-256 publicado. SDK/CMake se instalaron mediante el gestor oficial; no se conservaron sus ZIP para una comprobación independiente adicional.

## Incidencias resueltas y comprobaciones

- El Android CLI anterior, `cmdline-tools/latest` 23.0 / Android CLI 1.0.16261425, listaba paquetes pero terminaba con **-1073740791**. Está conservado y no se usa en PATH. El sdkmanager 19.0 lista y realiza la instalación idempotente con **código 0**.
- sdkmanager 19.0 avisa sobre XML SDK versión 4. El aviso no impidió reconocer SDK, Build Tools, NDK y CMake ni finalizar con código 0.
- El NDK registrado por el gestor anterior carecía de `clang.exe`. Se descargó el ZIP oficial con checksum, se extrajo con `tar.exe` y se conservó el directorio incompleto en `C:\Users\faust\AppData\Local\QualitzerAndroid\ndk-incomplete-cf9805f7`.
- Una extracción inicial de cmdline-tools mediante .NET falló por rutas largas. El instalador ahora usa `tar.exe` y staging corto. La extracción fallida quedó preservada en `cmdline-staging-2662f1f81e54474ba4fb407f06a18235`; no es parte del PATH.
- Ejecutables comprobados con código 0: java, javac, Gradle, sdkmanager, adb, aapt2, apksigner, ambos CMake, Ninja 3.22.1, clang, clang++, llvm-ar y ld.lld. Ningún comando compiló la app.
- No apareció ningún nuevo prompt de licencia; se reutilizó la licencia existente `android-sdk-license`. No se usó `yes`, aceptación masiva ni login EAS/Expo.
- Espacio libre observado en C: **269.52 GiB**. Raíz de herramientas: **5.01 GiB lógicos**, incluidos ZIP y copia incompleta preservada. El espacio puede cambiar por otros procesos.
- Metro 8081, PID **21240**, y pasarela 8787, PID **24524**, se mantuvieron activos, sin reinicio.

## Reproducir solamente la preparación

Desde PowerShell en la raíz de Qualitzer-Mobile:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
& .\scripts\android\Install-Toolchain.ps1
. .\scripts\android\Use-Toolchain.ps1
```

La política es únicamente de ese proceso, no de usuario/máquina. El instalador no acepta licencias automáticamente; si aparece un prompt, hay que responderlo explícitamente. `-BootstrapOnly` prepara Java/gestor/Gradle sin invocar instalación SDK.

## Alcance de los scripts

El instalador y activador solo preparan herramientas. El nuevo wrapper y runner gestionan prebuild, firma, compilación y entrega. Android generado, `.data` y `artifacts` están ignorados; se mantienen intactos la configuración principal, las variables `.env`, el runtime y los repositorios backend/frontend.