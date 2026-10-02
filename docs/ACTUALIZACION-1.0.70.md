# Nuevo icono de la app: APK 1.0.70 / gateway 1.0.31

Incluye todo lo de la [actualizacion 1.0.69](ACTUALIZACION-1.0.69.md).

- Nuevo icono y logo de Qualitzer tecnicos: Q hexagonal con insignia de llave sobre fondo blanco, aprobado el 2026-10-02. Reemplaza el icono anterior con fondo celeste difuminado.
- Se regeneran desde `assets/qualitzer-source.png` con `node scripts/generate-qualitzer-brand.cjs`: icono de la app (1024 px), primer plano del icono adaptativo de Android (1024 px, fondo `#FFFFFF`), logo dentro de la app (512 px) y favicon (64 px).
- El icono adaptativo mantiene la Q y la llave completas dentro del circulo seguro de Android (306 px de 313 px).
- El icono de notificaciones no cambia.

El gateway y el backend no cambian respecto de la 1.0.69. Actualizar la APK sin desinstalar la anterior; algunos lanzadores de Android tardan unos minutos en refrescar el icono.

## Verificacion local

5 pruebas de recursos de marca pasadas (fuente aprobada, regeneracion determinista, fondo blanco opaco, zona segura del icono adaptativo y rechazo de imagenes no aprobadas).
