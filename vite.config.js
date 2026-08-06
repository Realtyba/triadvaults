import { defineConfig, loadEnv } from 'vite';

/**
 * `TRIADVAULTS_API_URL` es la ÚNICA variable de la API externa, y la comparten el
 * servidor de salas y el cliente. Como no lleva el prefijo `VITE_`, Vite no la
 * expone sola al bundle: se inyecta aquí a mano como `__API_URL__`.
 *
 * Se hace con una lista explícita de una sola variable, y no ampliando `envPrefix`
 * a `TRIADVAULTS_`, porque con ese prefijo también viajarían al bundle del cliente
 * `TRIADVAULTS_JWT_SECRET` y `TRIADVAULTS_INTERNAL_SECRET`. Son secretos de
 * servidor y publicarlos permitiría a cualquiera firmarse un token de jugador.
 */
export default defineConfig(({ mode }) => {
  // Prefijo vacío: `loadEnv` solo filtra por prefijo lo que entrega, y de todo lo
  // que devuelve aquí abajo solo se usa la URL. Los secretos no salen de este
  // ámbito, que corre en Node durante el build.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    root: './',
    publicDir: 'public',
    define: {
      __API_URL__: JSON.stringify((env.TRIADVAULTS_API_URL || '').replace(/\/+$/, ''))
    },
    server: {
      port: 3000,
      open: false
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true
    }
  };
});
