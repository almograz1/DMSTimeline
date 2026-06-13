import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// The Firebase project whose hosted auth handler we proxy to.
const FIREBASE_AUTH_HOST = 'https://dmstimeline-15676.firebaseapp.com'

export default defineConfig({
  // basicSsl serves the dev server over HTTPS with a self-signed cert. This is
  // required for Google redirect sign-in to be *first-party*: the Firebase SDK
  // always builds the auth handler URL as https://<authDomain>/__/auth/handler,
  // and authDomain in dev is set to the app's own origin (localhost:5173). The
  // proxy below mirrors vercel.json so /__/auth and /__/firebase resolve to the
  // Firebase-hosted handler while the browser still sees them as localhost
  // (first-party) — sidestepping Chrome's third-party-storage block on redirect.
  plugins: [react(), basicSsl()],
  server: {
    proxy: {
      '/__/auth': { target: FIREBASE_AUTH_HOST, changeOrigin: true, secure: true },
      '/__/firebase': { target: FIREBASE_AUTH_HOST, changeOrigin: true, secure: true },
    },
  },
})
