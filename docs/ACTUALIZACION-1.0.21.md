# Qualitzer tecnicos 1.0.21

La seccion Checklists dentro de Trabajo muestra cada checklist en una tarjeta compacta con nombre, porcentaje, barra de avance y resumen de requisitos confirmados y pendientes. Tocar la tarjeta abre el mismo checklist y conserva la navegacion existente.

El avance utiliza el calculo compartido de requisitos: excluye pasos informativos, requisitos opcionales y archivos pendientes de confirmacion. Por ejemplo, 47 pasos con uno informativo y 2 requisitos confirmados se muestran como 2/46 confirmados, 44 pendientes y 4 %. El porcentaje indica respuestas con requisitos satisfechos, no el resultado favorable de una inspeccion.

Un checklist sin requisitos computables no muestra porcentaje. Los casos sin pasos y completados tienen resumen propio.

## Instalacion

APK 1.0.21, codigo Android 22. Instalar como actualizacion sobre la app existente, sin desinstalar ni borrar datos. Se conservan firma, identificador, API, respuestas, adjuntos y pendientes.

No requiere cambios nuevos de backend ni gateway respecto de 1.0.20. Conserva gateway 1.0.8 para las funcionalidades anteriores; no hay migraciones ni cambios de Firebase.

## Verificacion

32 pruebas enfocadas del detalle de trabajo aprobadas. Seis escenarios visuales con componentes reales y 146 aserciones, a 360, 390 y 1280 px con texto 100/200 %, sin errores de tipos en el grafo de la fixture. Cubren progreso parcial, completo, vacio, titulo largo, navegacion y limites del contenido. Se verifico que las evidencias pendientes no incrementen el progreso.

No se ejecutaron pruebas, SQL ni cambios del backend. La comprobacion visual usa React Native Web; no equivale a una prueba en telefono fisico.