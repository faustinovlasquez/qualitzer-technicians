# Galeria de mantenimiento en Android

APK 1.0.31, codigo Android 32.

- Se elimina el espacio vacio entre las pestanas y el gestor de archivos. Android envolvia el ScrollView con un contenedor de refresco que seguia ocupando espacio aunque su contenido estuviera oculto. Ahora se oculta toda esa seccion sin desmontar los paneles ni perder borradores.
- Camara, Galeria y Archivos permanecen arriba; las imagenes disponen de la lista central y el guardado permanece al pie.
- Los selectores muestran icono sobre etiqueta para evitar palabras partidas con texto grande. El boton compacto dice Guardar y muestra el numero de pendientes.
- El aviso exclusivo del navegador sobre archivos sin guardar pasa a la lista desplazable, sin eliminarlo ni ocupar el pie fijo.

No cambia la subida, el guardado automatico, los recibos, la cola, la lectura de archivos ni el borrado. No se necesita actualizar backend ni gateway respecto de 1.0.30. Se conserva gateway 1.0.11. Instalar como actualizacion, sin desinstalar ni borrar datos.

## Verificacion local

15 pruebas de seleccion, borradores y guardado aprobadas. Seis recorridos de componentes reales RN Web a 360/390/1280 px y texto 100/200 %, con 751 aserciones y 66 capturas, sin errores de tipos ni navegador. Comprueban la posicion de los botones, espacio de lista, al menos 140 px visibles de las imagenes y pixeles decodificados no vacios, para archivos pendientes, en cola y guardados. Cambiar de pestana no reenvia el archivo.

El contenedor Android se simula en navegador utilizando splitLayoutProps de la version instalada de React Native. La comparacion con la distribucion anterior, reconstruida solo en memoria, detecta un hueco de 330 px. El codigo corregido pasa. Esto no sustituye una prueba en telefono fisico: camara, ciclo de vida y API son simulados; no se subieron archivos reales ni se modificaron datos del servidor.

Informe corregido: artifacts/logs/time-sync-ui/2026-09-18T16-33-12-813Z/report.json.
Comparacion anterior con fallo esperado: artifacts/logs/time-sync-ui/2026-09-18T16-34-48-588Z/report.json.