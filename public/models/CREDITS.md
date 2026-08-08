# Créditos de los modelos

Generado por `scripts/fetch-assets.mjs`. **No se edita a mano**: la lista buena está en
`src/assets/manifest.js`, y `npm run validate:assets` falla si esto se queda atrás.

Casi todo sale del mismo pack, y no es casualidad: sus 81 piezas comparten **un único
atlas de 512×512 byte a byte idéntico**, y eso es lo que permite dibujar todo el atrezo de
una sala en una sola llamada. Ver `src/engine/mergedModel.js`.

Lo marcado como **CC0** es dominio público: se puede usar en proyectos personales,
educativos y comerciales, y no obliga a atribuir. Esta tabla existe igualmente para que
dentro de dos años se sepa de dónde salió cada fichero y bajo qué condiciones, que es
justo lo que no se puede reconstruir mirando un binario.

| Fichero | Pieza original | Pack | Autor | Licencia | Origen |
|---|---|---|---|---|---|
| `agent-1.glb` | `Astronaut.glb` | Ultimate Space Kit | Quaternius | CC0 | https://poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX |
| `agent-2.glb` | `Astronaut-0D54W8yfrA.glb` | Ultimate Space Kit | Quaternius | CC0 | https://poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX |
| `agent-3.glb` | `Astronaut-OgeSH89Nmx.glb` | Ultimate Space Kit | Quaternius | CC0 | https://poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX |
| `prop-container.glb` | `Pickup Crate.glb` | Ultimate Space Kit | Quaternius | CC0 | https://poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX |
| `prop-canister.glb` | `Pickup Jar.glb` | Ultimate Space Kit | Quaternius | CC0 | https://poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX |
| `prop-ammo.glb` | `Bullets Pickup.glb` | Ultimate Space Kit | Quaternius | CC0 | https://poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX |
| `prop-medkit.glb` | `Pickup Health.glb` | Ultimate Space Kit | Quaternius | CC0 | https://poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX |
| `prop-panel.glb` | `Solar Panel Ground.glb` | Ultimate Space Kit | Quaternius | CC0 | https://poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX |
| `prop-strut.glb` | `Metal Support.glb` | Ultimate Space Kit | Quaternius | CC0 | https://poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX |
| `ghost.glb` | `Enemy Large.glb` | Ultimate Space Kit | Quaternius | CC0 | https://poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX |
| `puzzle-core.glb` | `Pickup Thunder.glb` | Ultimate Space Kit | Quaternius | CC0 | https://poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX |
| `puzzle-gate.glb` | `Connector.glb` | Ultimate Space Kit | Quaternius | CC0 | https://poly.pizza/bundle/Ultimate-Space-Kit-YWh743lqGX |

## Estos ficheros no se descargan

El pack se baja entero de su página, no pieza a pieza, así que sus entradas van marcadas
`local: true` y sin `url`: `npm run assets` comprueba que estén y avisa si falta
alguna, pero no intenta traerlas. Los originales, con su nombre de origen, están en
`assets-src/ultimate-space-kit-glb/` —fuera de `public/`, que se copia entera al build
de Vite y al paquete de Electron—.

Si falta un fichero, el mensaje de error trae el `cp` exacto que lo repone.

## Si hace falta que pesen menos

Los agentes traen dieciocho animaciones y el juego usa cuatro (idle, andar, correr, morir);
el fantasma trae catorce y usa tres. Podar el resto es lo que más recorta, y se hace sin
añadir ninguna dependencia al proyecto:

```bash
npx --yes @gltf-transform/cli optimize public/models/agent-1.glb public/models/agent-1.glb
```

Si además el fotograma se resiente en un móvil, la palanca es la densidad de malla y no el
número de modelos: un agente ocupa unos veinte píxeles de alto y llega con 8 400 triángulos.

```bash
npx --yes @gltf-transform/cli optimize public/models/agent-1.glb public/models/agent-1.glb \
  --simplify-error 0.002
```

No está automatizado a propósito: es una herramienta externa que se descargaría en cada
ejecución, y hoy el tamaño no es el cuello de botella. Ojo con una cosa: como estos
ficheros no se vuelven a descargar, **podar es irreversible** salvo volviendo a copiar el
original desde `assets-src/`.
