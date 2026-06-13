import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// In dev we serve the app over HTTPS (vite basic-ssl) and proxy /__/auth +
// /__/firebase to the Firebase handler, so the app's own origin can act as the
// authDomain. That makes Google redirect sign-in first-party on localhost and
// avoids Chrome's third-party-storage block. In prod the Vercel domain already
// proxies those paths (see vercel.json), so it acts as its own authDomain too.
const devAuthDomain =
  typeof window !== 'undefined' ? window.location.host : import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.PROD ? 'dms-timeline.vercel.app' : devAuthDomain,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const db       = getFirestore(app);
export const auth     = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
