// src/firebase.ts
// ─────────────────────────────────────────────────────────────────────────────
// Firebase initialization. This file is the single place where Firebase is
// configured. Every other file that needs Firestore imports `db` from here.
//
// HOW TO FILL THIS IN:
//   1. Go to console.firebase.google.com → your project → Project Settings
//   2. Scroll to "Your apps" → click the </> web icon → register app
//   3. Copy the firebaseConfig object Firebase shows you and paste it below.
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Replace every value below with the ones from your Firebase console.
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

// initializeApp connects the SDK to your Firebase project.
// Calling it once here (module scope) ensures it's only initialized once
// even if firebase.ts is imported from multiple places.
const app = initializeApp(firebaseConfig);

// getFirestore returns the Firestore database instance tied to `app`.
// Export it so GanttContext (and any future file) can import `db` directly.
export const db = getFirestore(app);