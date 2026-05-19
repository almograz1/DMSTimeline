import React, { useState } from 'react';
import { useAuth } from './AuthContext';

interface Props {
  onClose: () => void;
}

export default function ProfileModal({ onClose }: Props) {
  const { user, updateDisplayName, linkWithGoogle } = useAuth();

  const [name, setName]       = useState(user?.displayName ?? '');
  const [saving, setSaving]   = useState(false);
  const [linking, setLinking] = useState(false);
  const [msg, setMsg]         = useState<{ text: string; ok: boolean } | null>(null);

  const hasPassword = user?.providerData.some(p => p.providerId === 'password') ?? false;
  const hasGoogle   = user?.providerData.some(p => p.providerId === 'google.com') ?? false;
  const nameChanged = name.trim() !== (user?.displayName ?? '');

  async function handleSaveName() {
    const trimmed = name.trim();
    if (!trimmed || !nameChanged) return;
    setSaving(true);
    setMsg(null);
    try {
      await updateDisplayName(trimmed);
      setMsg({ text: 'Display name updated.', ok: true });
    } catch {
      setMsg({ text: 'Failed to update display name. Try again.', ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkGoogle() {
    setLinking(true);
    setMsg(null);
    try {
      await linkWithGoogle();
      // Page navigates away for the redirect flow; code below won't run
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '';
      if (errMsg.includes('credential-already-in-use')) {
        setMsg({ text: 'That Google account is already linked to a different user.', ok: false });
      } else {
        setMsg({ text: 'Failed to link Google account. Try again.', ok: false });
      }
      setLinking(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--bg-surface)', borderRadius: 14, padding: 28, width: 400, boxShadow: '0 12px 48px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', gap: 20 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>Edit Profile</div>
          <button
            onClick={onClose}
            style={{ marginLeft: 'auto', width: 26, height: 26, borderRadius: 6, background: 'var(--bg-header)', color: 'var(--text-secondary)', fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >×</button>
        </div>

        {/* Account info */}
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '8px 12px', background: 'var(--bg-app)', borderRadius: 8 }}>
          <span style={{ color: 'var(--text-muted)' }}>Signed in as </span>
          <strong style={{ color: 'var(--text-primary)' }}>{user?.email}</strong>
        </div>

        {/* Display name */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
            Display Name
          </label>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
            This is how others find you when sharing timelines. Use your full name in a recognisable format.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="form-input"
              value={name}
              onChange={e => { setName(e.target.value); setMsg(null); }}
              onKeyDown={e => e.key === 'Enter' && handleSaveName()}
              placeholder="Your full name"
              style={{ flex: 1 }}
            />
            <button
              className="btn-primary"
              onClick={handleSaveName}
              disabled={saving || !name.trim() || !nameChanged}
              style={{ opacity: (!name.trim() || !nameChanged) ? 0.5 : 1, whiteSpace: 'nowrap' }}
            >
              {saving ? '…' : 'Save'}
            </button>
          </div>
        </div>

        {/* Link Google — only for password-only accounts */}
        {hasPassword && !hasGoogle && (
          <div style={{ padding: 16, borderRadius: 10, background: 'var(--bg-app)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Link Google Account</div>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
              Link your Google account so you can sign in with Google going forward. All your timeline data will be preserved.
            </p>
            <button
              onClick={handleLinkGoogle}
              disabled={linking}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 14px', borderRadius: 8,
                background: '#fff', border: '1.5px solid var(--border)',
                fontSize: 13, fontWeight: 600, color: '#333',
                cursor: linking ? 'not-allowed' : 'pointer',
                opacity: linking ? 0.7 : 1,
                transition: 'box-shadow 0.15s',
              }}
              onMouseEnter={e => !linking && (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
            >
              <svg width="16" height="16" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
              </svg>
              {linking ? 'Redirecting…' : 'Link Google Account'}
            </button>
          </div>
        )}

        {hasGoogle && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#22c55e', padding: '8px 12px', background: '#f0fdf4', borderRadius: 8 }}>
            <svg width="14" height="14" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
              <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"/>
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
            </svg>
            Google account connected
          </div>
        )}

        {msg && (
          <p style={{
            fontSize: 12, margin: 0,
            color: msg.ok ? '#22c55e' : '#ef4444',
            background: msg.ok ? '#f0fdf4' : '#fee2e2',
            padding: '8px 12px', borderRadius: 6,
          }}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
