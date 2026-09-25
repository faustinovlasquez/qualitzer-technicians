# APK 1.0.62: ubicacion propia del equipo

Correccion exclusiva de la app movil, codigo Android 63. La captura de la web era una referencia, no el alcance del cambio. Se retiraron los cambios web y el endpoint web introducidos por error en la tarea anterior.

## Cambios

- EquipmentLocationPanel muestra `address`, la direccion asociada al equipo que ya lee y modifica la API movil. No la sustituye por `currentAddress` ni por `currentLabel` del despacho o resguardo.
- Ver mapa y Editar usan esa misma direccion. Sin direccion asociada muestra ausencia de registro, sin inventar una ubicacion.
- El texto no repite los componentes de una direccion completa. Al modificar manualmente la direccion se retiran las coordenadas anteriores; Google/GPS siguen siendo acciones explicitas.
- El mapa nativo sigue los cambios del borrador y elimina el marcador si las coordenadas se borran. No hace una geocodificacion al abrir para cambiar lo guardado.
- El guardado conserva `expected: location.address`, identidad del equipo, permisos, bloqueo por falta de conexion y proteccion frente a doble pulsacion.

## Instalacion

Instalar como actualizacion, sin desinstalar ni borrar datos. Se conserva la firma y el servidor configurado. No hay cambios nuevos de backend, gateway, esquema o migraciones para esta correccion. Requiere el endpoint movil de ubicacion ya utilizado por la APK anterior; no usa la ruta web de customers_equipments.

El gateway 1.0.28 y los requisitos backend de actividades offline de 1.0.61 siguen siendo los anteriores, no se instalaron ni verificaron remotamente en esta tarea. No es necesario reinstalarlos por este cambio de ubicacion.

## Verificacion

128 pruebas Mobile/gateway y tipos sin errores. Seis escenarios RN Web con el panel real y el adaptador de mapa nativo, en 360/390/1280 px y texto normal/ampliado. Google, GPS y API simulados; no comprobacion en telefono fisico ni escrituras reales. La rama main local del backend no contiene PanelEquipmentLocation; no se cambiaron ramas ni se restauraron modulos ajenos.