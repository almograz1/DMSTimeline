import React, { useState } from 'react';
import { useAuth } from './AuthContext';

/**
 * Shown once, right after a user registers with Google. Asks them to confirm /
 * set a recognisable display name so colleagues can find them when sharing a
 * timeline (sharing search matches on displayName). Intentionally blocking and
 * not dismissable by clicking the backdrop — we want every new account to have
 * a name set — but it can be skipped to keep the Google-provided name.
 */
export default function DisplayNameModal() {
  const { user, updateDisplayName, finishDisplayNameSetup } = useAuth();

  const [name, setName]     = useState(user?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError('');
    try {
      if (trimmed !== (user?.displayName ?? '')) {
        await updateDisplayName(trimmed);
      }
      finishDisplayNameSetup();
    } catch {
      setError('Could not save your name. Please try again.');
      setSaving(false);
    }
  }

  const canSave = !!name.trim();

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{ background: 'var(--bg-surface)', borderRadius: 14, padding: 28, width: 420, boxShadow: '0 12px 48px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', gap: 18 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>👋</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Welcome!</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Let's set your display name</div>
          </div>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
          This is the name other Philips employees will see and search for when they want
          to <strong style={{ color: 'var(--text-primary)' }}>share a timeline with you</strong>. Use your full name in a recognisable format.
        </p>

        {/* Name input */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
            Display Name
          </label>
          <input
            autoFocus
            className="form-input"
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter' && canSave) handleSave(); }}
            placeholder="e.g. Jane Doe"
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
        </div>

        {error && (
          <p style={{ fontSize: 12, color: '#ef4444', background: '#fee2e2', padding: '8px 12px', borderRadius: 6, margin: 0 }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn-ghost"
            onClick={finishDisplayNameSetup}
            disabled={saving}
            style={{ fontSize: 12 }}
          >
            Skip for now
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={saving || !canSave}
            style={{ opacity: canSave ? 1 : 0.5, minWidth: 120 }}
          >
            {saving ? 'Saving…' : 'Save & continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
