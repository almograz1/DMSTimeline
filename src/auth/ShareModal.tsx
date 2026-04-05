import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, setDoc, doc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import type { Timeline } from '../types';

interface Member {
  userId: string;
  email: string;
  role: 'owner' | 'editor';
}

interface Props {
  timeline: Timeline;
  onClose: () => void;
}

export default function ShareModal({ timeline, onClose }: Props) {
  const { user } = useAuth();
  const [members, setMembers]     = useState<Member[]>([]);
  const [email, setEmail]         = useState('');
  const [status, setStatus]       = useState<{ msg: string; ok: boolean } | null>(null);
  const [loading, setLoading]     = useState(false);

  // Load current members
  useEffect(() => {
    const q = query(collection(db, 'timelineMembers'), where('timelineId', '==', timeline.id));
    const unsub = onSnapshot(q, snap => {
      setMembers(snap.docs.map(d => d.data() as Member));
    });
    return unsub;
  }, [timeline.id]);

  async function handleInvite() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setLoading(true);
    setStatus(null);

    try {
      // Look up the user by email in userProfiles
      const profileSnap = await getDocs(
        query(collection(db, 'userProfiles'), where('email', '==', trimmed))
      );

      if (profileSnap.empty) {
        setStatus({ msg: `No account found for "${trimmed}". They need to sign up first.`, ok: false });
        setLoading(false);
        return;
      }

      const profile    = profileSnap.docs[0].data();
      const inviteeUid = profile.uid as string;

      if (inviteeUid === user?.uid) {
        setStatus({ msg: "You're already the owner of this timeline.", ok: false });
        setLoading(false);
        return;
      }

      if (members.some(m => m.userId === inviteeUid)) {
        setStatus({ msg: 'This person already has access.', ok: false });
        setLoading(false);
        return;
      }

      // Add member document
      await setDoc(doc(db, 'timelineMembers', `${timeline.id}_${inviteeUid}`), {
        timelineId: timeline.id,
        userId:     inviteeUid,
        email:      trimmed,
        role:       'editor',
      });

      setStatus({ msg: `${trimmed} now has access to this timeline.`, ok: true });
      setEmail('');
    } catch (err) {
      setStatus({ msg: 'Something went wrong. Try again.', ok: false });
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(memberId: string, memberEmail: string) {
    if (!window.confirm(`Remove ${memberEmail} from this timeline?`)) return;
    await deleteDoc(doc(db, 'timelineMembers', `${timeline.id}_${memberId}`));
  }

  const isOwner = timeline.userId === user?.uid;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 14, padding: 28, width: 420, boxShadow: '0 12px 48px rgba(0,0,0,0.25)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <span style={{ fontSize: 20 }}>🔗</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>Share Timeline</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{timeline.name}</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', width: 24, height: 24, borderRadius: 6, background: 'var(--bg-header)', color: 'var(--text-secondary)', fontSize: 16 }}>×</button>
        </div>

        {/* Invite input — only for owner */}
        {isOwner && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>
              Invite by email
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                type="email"
                placeholder="colleague@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleInvite()}
                style={{ flex: 1 }}
              />
              <button
                className="btn-primary"
                onClick={handleInvite}
                disabled={loading || !email.trim()}
                style={{ opacity: email.trim() ? 1 : 0.5, whiteSpace: 'nowrap' }}
              >
                {loading ? '…' : 'Invite'}
              </button>
            </div>
            {status && (
              <p style={{ fontSize: 12, marginTop: 8, color: status.ok ? '#22c55e' : '#ef4444', background: status.ok ? '#f0fdf4' : '#fee2e2', padding: '6px 10px', borderRadius: 6 }}>
                {status.msg}
              </p>
            )}
          </div>
        )}

        {/* Members list */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>
            People with access
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Owner */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-app)' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>
                {(timeline as any).ownerEmail?.slice(0,2).toUpperCase() ?? 'ME'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{(timeline as any).ownerEmail ?? user?.email}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Owner</div>
              </div>
            </div>

            {/* Editors */}
            {members.map(m => (
              <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-app)' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 11, fontWeight: 700 }}>
                  {m.email.slice(0,2).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{m.email}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Editor</div>
                </div>
                {isOwner && (
                  <button onClick={() => handleRemove(m.userId, m.email)}
                    style={{ fontSize: 11, color: '#ef4444', background: '#fee2e2', padding: '3px 8px', borderRadius: 5 }}>
                    Remove
                  </button>
                )}
              </div>
            ))}

            {members.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                Only you have access to this timeline.
              </p>
            )}
          </div>
        </div>

        <div style={{ marginTop: 20, padding: '10px 14px', borderRadius: 8, background: '#f8fafc', fontSize: 11, color: 'var(--text-muted)' }}>
          💡 Editors can view and edit all projects, tasks and milestones in this timeline. Changes sync in real time.
        </div>
      </div>
    </div>
  );
}
