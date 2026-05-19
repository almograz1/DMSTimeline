import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, signOut, updateProfile, linkWithRedirect,
  type User,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const db = getFirestore();

async function writeUserProfile(user: User) {
  const displayName = user.displayName ?? '';
  await setDoc(doc(db, 'userProfiles', user.uid), {
    uid: user.uid,
    email: user.email?.toLowerCase() ?? '',
    displayName,
    displayNameLower: displayName.toLowerCase(),
  }, { merge: true });
}

function snapshotUser(u: User): User {
  return Object.assign(Object.create(Object.getPrototypeOf(u)), u) as User;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  linkWithGoogle: () => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const redirectHandled       = useRef(false);

  useEffect(() => {
    // Check for redirect result first (runs once on mount)
    if (!redirectHandled.current) {
      redirectHandled.current = true;
      getRedirectResult(auth).then(async result => {
        if (result?.user) {
          await writeUserProfile(result.user);
          setUser(snapshotUser(result.user));
        }
      }).catch(err => {
        console.error('[Auth] getRedirectResult error:', err);
      }).finally(() => {
        // onAuthStateChanged will set loading=false; this is belt-and-suspenders
      });
    }

    const unsub = onAuthStateChanged(auth, u => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const signInWithGoogle = async () => {
    await signInWithRedirect(auth, googleProvider);
    // Page navigates away — no code runs after this
  };

  const signInWithEmail = async (email: string, password: string) => {
    const result = await signInWithEmailAndPassword(auth, email, password);
    await writeUserProfile(result.user);
  };

  const linkWithGoogle = async () => {
    if (!auth.currentUser) throw new Error('Not logged in');
    await signInWithRedirect(auth, googleProvider);
    // Page navigates away; result is processed in getRedirectResult on return
  };

  const updateDisplayName = async (name: string) => {
    if (!auth.currentUser) throw new Error('Not logged in');
    await updateProfile(auth.currentUser, { displayName: name });
    await writeUserProfile(auth.currentUser);
    setUser(snapshotUser(auth.currentUser));
  };

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signInWithEmail, linkWithGoogle, updateDisplayName, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
