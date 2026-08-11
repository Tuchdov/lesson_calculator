import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/

// Single source of truth for the CSP. The dev server needs a looser policy than
// production: Vite injects the react-refresh preamble as an inline module script
// and talks to the HMR server over a websocket.
function buildCsp(isDev) {
  return [
    "default-src 'self'",
    `script-src 'self' https://accounts.google.com/gsi/${isDev ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `font-src https://fonts.gstatic.com${isDev ? ' data:' : ''}`,
    `connect-src 'self' https://www.googleapis.com https://accounts.google.com${isDev ? ' ws: wss:' : ''}`,
    'frame-src https://accounts.google.com',
    "img-src 'self' data: blob: https:",
  ].join('; ')
}

// Keeps the <meta> CSP in index.html in sync with the policy above, so dev and
// production builds can't drift apart.
function cspPlugin(isDev) {
  return {
    name: 'inject-csp-meta',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: buildCsp(isDev),
          },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

export default defineConfig(({ command }) => {
  const isDev = command === 'serve'
  return {
    plugins: [react(), cspPlugin(isDev)],
    server: {
      headers: { 'Content-Security-Policy': buildCsp(isDev) },
    },
  }
})
