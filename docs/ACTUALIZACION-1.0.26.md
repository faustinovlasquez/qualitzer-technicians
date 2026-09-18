# Qualitzer tecnicos 1.0.26

## Selector de agenda

Corrige los estilos del selector situado antes de Mi agenda, que podia aparecer como una barra estrecha y muy alta sin etiquetas legibles. El selector ahora tiene el ancho del contenido y dos botones que comparten la fila, con texto adaptable al tamano de fuente. Se evita combinar un ancho intrinseco sin definir con flex en los botones.

Se conserva el cambio entre Agenda y Filtros / OTs, las fechas, el calendario, los filtros y las asignaciones. La seleccion tambien se expone explicitamente a accesibilidad. No se modifican datos ni acciones de negocio.

## Instalacion

APK 1.0.26, codigo Android 27, misma firma, paquete y API. Instalar como actualizacion; no desinstalar ni limpiar datos, borradores o pendientes. Se conserva la APK 1.0.25 anterior y su funcionalidad de firmas.

Esta correccion es solo de interfaz. No requiere cambios adicionales de backend ni gateway respecto de 1.0.25. El gateway sigue en 1.0.10; la funcionalidad de firmas conserva sus requisitos de despliegue anteriores.

## Verificacion

Seis pruebas enfocadas aprobadas y cero errores de tipos en DashboardScreen, sus pruebas y el escenario de interfaz. Regresion de ancho definido, reparto de botones y cambio entre lista y calendario.

Ocho escenarios RN Web aprobados, anchos 320, 360, 390 y 1024 con texto normal y al 200%: altura acotada, ancho alineado al contenido, dos botones legibles de al menos 44 px, sin hueco excesivo antes del titulo y navegacion sin mutaciones de datos. Ocho capturas. Informe: artifacts/logs/compact-overview-ui/2026-09-18T13-52-42-672Z/report.json.

La comprobacion visual usa el componente real con adaptadores de sistema simulados. No sustituye la verificacion del calculo de layout en un telefono Android real; ese recorrido queda pendiente. No se ejecutaron operaciones de negocio ni herramientas de validacion del backend.