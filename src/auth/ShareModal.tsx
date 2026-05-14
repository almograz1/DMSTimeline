import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, setDoc, doc, deleteDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import type { Timeline } from '../types';
import type { TimelineRole } from './TimelineContext';

interface Member {
  userId: string;
  email: string;
  role: TimelineRole;
}

interface Props {
  timeline: Timeline;
  onClose: () => void;
}

const ROLE_LABELS: Record<TimelineRole, string> = {
  owner:  'Owner',
  editor: 'Editor',
  viewer: 'View Only',
};

export default function ShareModal({ timeline, onClose }: Props) {
  const { user } = useAuth();
  const [members, setMembers]       = useState<Member[]>([]);
  const [email, setEmail]           = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [status, setStatus]         = useState<{ msg: string; ok: boolean } | null>(null);
  const [loading, setLoading]       = useState(false);

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

      if (members.some(m => m.userId === inviteeUid && m.role !== 'owner')) {
        setStatus({ msg: 'This person already has access. Change their role below.', ok: false });
        setLoading(false);
        return;
      }

      await setDoc(doc(db, 'timelineMembers', `${timeline.id}_${inviteeUid}`), {
        timelineId: timeline.id,
        userId:     inviteeUid,
        email:      trimmed,
        role:       inviteRole,
      });

      setStatus({ msg: `${trimmed} added as ${ROLE_LABELS[inviteRole]}.`, ok: true });
      setEmail('');
    } catch {
      setStatus({ msg: 'Something went wrong. Try again.', ok: false });
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(memberId: string, memberEmail: string) {
    if (!window.confirm(`Remove ${memberEmail} from this timeline?`)) return;
    await deleteDoc(doc(db, 'timelineMembers', `${timeline.id}_${memberId}`));
  }

  async function handleRoleChange(member: Member, newRole: 'editor' | 'viewer') {
    await updateDoc(doc(db, 'timelineMembers', `${timeline.id}_${member.userId}`), { role: newRole });
  }

  const isOwner       = timeline.userId === user?.uid;
  const nonOwnerMembers = members.filter(m => m.role !== 'owner');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 14, padding: 28, width: 440, boxShadow: '0 12px 48px rgba(0,0,0,0.25)' }}
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

        {/* Invite — owner only */}
        {isOwner && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>
              Invite by email
            </label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
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

            {/* Role toggle for invite */}
            <div style={{ display: 'flex', gap: 6 }}>
              {(['editor', 'viewer'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setInviteRole(r)}
                  style={{
                    padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    background: inviteRole === r ? 'var(--accent)' : 'var(--bg-header)',
                    color: inviteRole === r ? '#fff' : 'var(--text-secondary)',
                    border: inviteRole === r ? 'none' : '1px solid var(--border)',
                    cursor: 'pointer',
                  }}
                >
                  {ROLE_LABELS[r]}
                </button>
              ))}
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

            {/* Owner row */}
            <MemberRow
              initials={(timeline as any).ownerEmail?.slice(0, 2).toUpperCase() ?? 'ME'}
              email={(timeline as any).ownerEmail ?? user?.email ?? ''}
              role="owner"
            />

            {/* Non-owner members */}
            {nonOwnerMembers.map(m => (
              <MemberRow
                key={m.userId}
                initials={m.email.slice(0, 2).toUpperCase()}
                email={m.email}
                role={m.role}
                onRoleChange={isOwner ? (r) => handleRoleChange(m, r) : undefined}
                onRemove={isOwner ? () => handleRemove(m.userId, m.email) : undefined}
              />
            ))}

            {nonOwnerMembers.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                Only you have access to this timeline.
              </p>
            )}
          </div>
        </div>

        <div style={{ marginTop: 20, padding: '10px 14px', borderRadius: 8, background: '#f8fafc', fontSize: 11, color: 'var(--text-muted)' }}>
          💡 <strong>Editors</strong> can view and edit everything. <strong>View Only</strong> members can see the timeline but cannot make changes.
        </div>
      </div>
    </div>
  );
}

function MemberRow({ initials, email, role, onRoleChange, onRemove }: {
  initials: string;
  email: string;
  role: TimelineRole;
  onRoleChange?: (r: 'editor' | 'viewer') => void;
  onRemove?: () => void;
}) {
  const isOwner = role === 'owner';
  const roleColor = role === 'viewer' ? '#f59e0b' : role === 'editor' ? '#6366f1' : '#22c55e';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-app)' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: isOwner ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isOwner ? '#fff' : '#64748b', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
        <div style={{ fontSize: 10, color: roleColor, fontWeight: 600 }}>{ROLE_LABELS[role]}</div>
      </div>

      {/* Role switcher — only for non-owner members when caller is owner */}
      {onRoleChange && !isOwner && (
        <div style={{ display: 'flex', gap: 4 }}>
          {(['editor', 'viewer'] as const).map(r => (
            <button
              key={r}
              onClick={() => onRoleChange(r)}
              title={`Set as ${ROLE_LABELS[r]}`}
              style={{
                padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: role === r ? roleColor : 'var(--bg-header)',
                color: role === r ? '#fff' : 'var(--text-muted)',
                border: role === r ? 'none' : '1px solid var(--border)',
              }}
            >
              {r === 'editor' ? 'Edit' : 'View'}
            </button>
          ))}
        </div>
      )}

      {onRemove && (
        <button onClick={onRemove}
          style={{ fontSize: 11, color: '#ef4444', background: '#fee2e2', padding: '3px 8px', borderRadius: 5, flexShrink: 0 }}>
          Remove
        </button>
      )}
    </div>
  );
}
