import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "connect-src 'self' https://www.googleapis.com https://accounts.google.com",
  "frame-src https://accounts.google.com",
  "img-src 'self' data: blob: https:",
].join('; ')

export default defineConfig({
  plugins: [react()],
  server: {
    headers: { 'Content-Security-Policy': CSP },
  },
})
