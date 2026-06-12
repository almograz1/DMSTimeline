import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, signOut, updateProfile, linkWithRedirect,
  getAdditionalUserInfo,
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

// localStorage key marking that a user signed up but hasn't finished the
// "set your display name" onboarding step yet. Survives a page reload so the
// prompt reappears if the user closed the tab before completing it.
const ONBOARD_KEY = (uid: string) => `dms-onboard-pending-${uid}`;

// Set right before we navigate away for a Google redirect sign-in. If we come
// back and this is still set but no session was established, the browser blocked
// the cross-origin storage that signInWithRedirect relies on.
const REDIRECT_PENDING_KEY = 'dms-auth-redirect-pending';

/** Turn a Firebase auth error into a short, actionable message for the login page */
function describeAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  if (code.includes('unauthorized-domain'))
    return `This domain (${window.location.host}) isn't authorized in Firebase. Add it under Authentication → Settings → Authorized domains.`;
  if (code.includes('operation-not-allowed'))
    return 'Google sign-in is disabled for this project. Enable it in Firebase → Authentication → Sign-in method.';
  if (code.includes('network-request-failed'))
    return 'Network error reaching Firebase. Check your connection and try again.';
  const msg = err instanceof Error ? err.message : String(err);
  return msg || 'Sign-in failed.';
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** True when a freshly registered user still needs to set their display name */
  needsDisplayName: boolean;
  /** A diagnostic message to show on the login page after a failed/incomplete sign-in */
  authNotice: string | null;
  clearAuthNotice: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  linkWithGoogle: () => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  /** Mark the display-name onboarding as finished (dismisses the prompt) */
  finishDisplayNameSetup: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]                     = useState<User | null>(null);
  const [loading, setLoading]               = useState(true);
  const [needsDisplayName, setNeedsName]    = useState(false);
  const [authNotice, setAuthNotice]         = useState<string | null>(null);
  const redirectHandled                     = useRef(false);

  useEffect(() => {
    // Surface the auth config so a misconfigured/cross-origin authDomain is
    // obvious in the console (the #1 cause of "signs in then bounces to login").
    console.info(
      '[Auth] origin=%s  authDomain=%s',
      window.location.origin,
      auth.app.options.authDomain,
    );

    // Check for redirect result first (runs once on mount)
    if (!redirectHandled.current) {
      redirectHandled.current = true;
      getRedirectResult(auth).then(async result => {
        if (result?.user) {
          sessionStorage.removeItem(REDIRECT_PENDING_KEY);
          await writeUserProfile(result.user);
          // First-ever sign-in for this account → prompt them to set a display
          // name so colleagues can find them when sharing timelines.
          if (getAdditionalUserInfo(result)?.isNewUser) {
            localStorage.setItem(ONBOARD_KEY(result.user.uid), '1');
            setNeedsName(true);
          }
          setUser(snapshotUser(result.user));
        }
      }).catch(err => {
        console.error('[Auth] getRedirectResult error:', err);
        setAuthNotice(describeAuthError(err));
        sessionStorage.removeItem(REDIRECT_PENDING_KEY);
      }).finally(() => {
        // We kicked off a redirect but came back with no session and no error →
        // the browser almost certainly blocked the cross-origin storage that
        // signInWithRedirect needs (common on localhost where authDomain differs
        // from the app origin). Tell the user instead of silently bouncing.
        if (sessionStorage.getItem(REDIRECT_PENDING_KEY) && !auth.currentUser) {
          sessionStorage.removeItem(REDIRECT_PENDING_KEY);
          setAuthNotice(
            "Sign-in didn't complete. Your browser likely blocked the third-party " +
            'storage that redirect sign-in needs. Try the deployed app, or allow ' +
            'third-party cookies for this site, then sign in again.',
          );
        }
      });
    }

    const unsub = onAuthStateChanged(auth, u => {
      setUser(u);
      if (u) setAuthNotice(null);
      // Re-show the prompt after a reload if onboarding never completed.
      if (u && localStorage.getItem(ONBOARD_KEY(u.uid)) === '1') setNeedsName(true);
      setLoading(false);
    });
    return unsub;
  }, []);

  const signInWithGoogle = async () => {
    setAuthNotice(null);
    // Mark that a redirect is in flight so we can detect a silent failure on return.
    sessionStorage.setItem(REDIRECT_PENDING_KEY, '1');
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

  const finishDisplayNameSetup = () => {
    if (auth.currentUser) localStorage.removeItem(ONBOARD_KEY(auth.currentUser.uid));
    setNeedsName(false);
  };

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, needsDisplayName, authNotice, clearAuthNotice: () => setAuthNotice(null), signInWithGoogle, signInWithEmail, linkWithGoogle, updateDisplayName, finishDisplayNameSetup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
