# Manos Limpias AR 🧼🦠

Web app de realidad aumentada (en el navegador, sin instalar nada) que detecta
tus manos con la cámara y simula "gérmenes" sobre ellas para incentivar el
lavado de manos. Un switch alterna entre **Sucias** (aparecen los gérmenes) y
**Limpias** (los gérmenes desaparecen con una animación).

## Cómo funciona

- Usa la cámara del dispositivo (`getUserMedia`).
- Detecta la posición de la mano en tiempo real con
  [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
  (se ejecuta localmente en el navegador vía WebAssembly, no se envía video a
  ningún servidor).
- Dibuja gérmenes animados anclados a puntos de la palma y los dedos.
- El switch "Sucias / Limpias" controla si los gérmenes se muestran o se
  desvanecen; cuenta cuántos se han "eliminado" en total.

Es 100% HTML/CSS/JS sin paso de build ni dependencias que instalar.

## Ejecutar localmente

Sirve la carpeta con cualquier servidor estático, por ejemplo:

```bash
python3 -m http.server 8000
# o
npx serve .
```

Abre `http://localhost:8000` en el navegador (Chrome/Edge/Safari recientes).

> **Importante:** el acceso a la cámara requiere un contexto seguro. Funciona
> en `localhost` para pruebas, pero para usarlo en un teléfono necesitas
> desplegarlo detrás de **HTTPS** (por ejemplo GitHub Pages, Netlify o
> Vercel).

## Uso

1. Abre la app y otorga permiso de cámara.
2. Apunta la cámara hacia tus manos (usa "Cambiar cámara" para elegir
   frontal/trasera según tu dispositivo).
3. Verás gérmenes simulados sobre tus manos.
4. Mueve el switch a "✨ Limpias" para simular el lavado y ver cómo
   desaparecen. Muévelo de vuelta a "🦠 Sucias" para que reaparezcan.

Es una simulación educativa: no detecta gérmenes reales, solo tu mano.

## Estructura

- `index.html` — estructura de la página y controles.
- `style.css` — estilos (tema oscuro, switch, HUD).
- `app.js` — acceso a cámara, detección de manos (MediaPipe) y animación de
  los gérmenes en `<canvas>`.
