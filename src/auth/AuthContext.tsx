import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword,
  signOut, updateProfile, linkWithPopup,
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

// Create a fresh object from a Firebase User so React detects the state change
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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const signInWithGoogle = async () => {
    const result = await signInWithPopup(auth, googleProvider);
    await writeUserProfile(result.user);
    setUser(snapshotUser(result.user));
  };

  const signInWithEmail = async (email: string, password: string) => {
    const result = await signInWithEmailAndPassword(auth, email, password);
    await writeUserProfile(result.user);
  };

  const linkWithGoogle = async () => {
    if (!auth.currentUser) throw new Error('Not logged in');
    const result = await linkWithPopup(auth.currentUser, googleProvider);
    await writeUserProfile(result.user);
    setUser(snapshotUser(result.user));
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
