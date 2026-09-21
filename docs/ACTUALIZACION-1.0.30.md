# Creacion sin avisos confusos de cobertura

APK 1.0.30, codigo Android 31. Cambio limitado a la presentacion del formulario de creacion.

- Se retira la tarjeta no bloqueante de cobertura cuando faltan datos de agenda, la agenda esta vacia o no se detectan cruces.
- Se elimina la fecha tecnica de carga de esa tarjeta.
- Si hay horarios superpuestos entre los trabajos cargados, se conserva un aviso breve con los trabajos coincidentes y la indicacion de que se puede continuar.
- No se presenta la ausencia del aviso como una garantia de disponibilidad. Validaciones, payload, borradores, cola offline y confirmacion de creacion no cambian.

Instalar como actualizacion, sin desinstalar ni borrar datos. No requiere cambios adicionales de servidor ni gateway respecto de 1.0.29. Se mantienen los requisitos previos de la entrega tecnica de OT: backend actualizado y gateway 1.0.11. No hay migracion nueva.

## Verificacion

9 pruebas enfocadas del formulario aprobadas. 12 recorridos RN Web, 689 aserciones y 30 capturas a 360/390/1280 px y texto 100/200 %, sin errores de tipos o navegador. Casos de agenda sin datos, vacia, sin cruces y con cruce, tanto en horario como en revision; acciones habilitadas y cero solicitudes de creacion. API y sistema operativo simulados. No prueba en telefono fisico ni escritura real en el servidor.