import React, { useState, useEffect, useRef } from 'react';
import {
  collection, query, where, getDocs, setDoc, doc, deleteDoc,
  onSnapshot, updateDoc, limit,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import type { Timeline } from '../types';
import type { TimelineRole } from './TimelineContext';

interface Member {
  userId: string;
  email: string;
  displayName?: string;
  role: TimelineRole;
}

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
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
  const [members, setMembers]             = useState<Member[]>([]);
  const [search, setSearch]               = useState('');
  const [suggestions, setSuggestions]     = useState<UserProfile[]>([]);
  const [showDropdown, setShowDropdown]   = useState(false);
  const [selectedUser, setSelectedUser]   = useState<UserProfile | null>(null);
  const [inviteRole, setInviteRole]       = useState<'editor' | 'viewer'>('editor');
  const [status, setStatus]               = useState<{ msg: string; ok: boolean } | null>(null);
  const [loading, setLoading]             = useState(false);
  const searchRef                         = useRef<HTMLInputElement>(null);
  const dropdownRef                       = useRef<HTMLDivElement>(null);

  // Load members in real-time
  useEffect(() => {
    const q = query(collection(db, 'timelineMembers'), where('timelineId', '==', timeline.id));
    const unsub = onSnapshot(q, snap => {
      setMembers(snap.docs.map(d => d.data() as Member));
    });
    return unsub;
  }, [timeline.id]);

  // Debounced display-name search
  useEffect(() => {
    if (selectedUser) return; // already picked, don't re-query
    setSuggestions([]);
    setShowDropdown(false);

    const term = search.trim().toLowerCase();
    if (term.length < 1) return;

    const timer = setTimeout(async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'userProfiles'),
            where('displayNameLower', '>=', term),
            where('displayNameLower', '<=', term + ''),
            limit(8)
          )
        );
        const results = snap.docs
          .map(d => d.data() as UserProfile)
          .filter(p =>
            p.uid !== user?.uid &&
            !members.some(m => m.userId === p.uid)
          );
        setSuggestions(results);
        setShowDropdown(true);
      } catch {
        // Ignore search errors silently
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [search, user?.uid, members, selectedUser]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current && !searchRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function selectSuggestion(profile: UserProfile) {
    setSelectedUser(profile);
    setSearch('');
    setSuggestions([]);
    setShowDropdown(false);
    setStatus(null);
  }

  function clearSelection() {
    setSelectedUser(null);
    setSearch('');
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  async function handleInvite() {
    if (!selectedUser) return;
    setLoading(true);
    setStatus(null);

    try {
      if (members.some(m => m.userId === selectedUser.uid && m.role !== 'owner')) {
        setStatus({ msg: 'This person already has access. Change their role below.', ok: false });
        return;
      }

      await setDoc(doc(db, 'timelineMembers', `${timeline.id}_${selectedUser.uid}`), {
        timelineId:  timeline.id,
        userId:      selectedUser.uid,
        email:       selectedUser.email,
        displayName: selectedUser.displayName,
        role:        inviteRole,
      });

      const label = selectedUser.displayName || selectedUser.email;
      setStatus({ msg: `${label} added as ${ROLE_LABELS[inviteRole]}.`, ok: true });
      setSelectedUser(null);
      setSearch('');
    } catch {
      setStatus({ msg: 'Something went wrong. Try again.', ok: false });
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(memberId: string, memberLabel: string) {
    if (!window.confirm(`Remove ${memberLabel} from this timeline?`)) return;
    await deleteDoc(doc(db, 'timelineMembers', `${timeline.id}_${memberId}`));
  }

  async function handleRoleChange(member: Member, newRole: 'editor' | 'viewer') {
    await updateDoc(doc(db, 'timelineMembers', `${timeline.id}_${member.userId}`), { role: newRole });
  }

  const isOwner         = timeline.userId === user?.uid;
  const nonOwnerMembers = members.filter(m => m.role !== 'owner');
  const ownerMember     = members.find(m => m.role === 'owner');
  const ownerLabel      = ownerMember?.displayName || ownerMember?.email || (timeline as any).ownerEmail || user?.email || '';
  const ownerInitials   = ownerLabel.slice(0, 2).toUpperCase();

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--bg-surface)', borderRadius: 14, padding: 28, width: 460, boxShadow: '0 12px 48px rgba(0,0,0,0.25)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <span style={{ fontSize: 20 }}>🔗</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>Share Timeline</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{timeline.name}</div>
          </div>
          <button
            onClick={onClose}
            style={{ marginLeft: 'auto', width: 26, height: 26, borderRadius: 6, background: 'var(--bg-header)', color: 'var(--text-secondary)', fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >×</button>
        </div>

        {/* Invite — owner only */}
        {isOwner && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>
              Invite by name
            </label>

            {/* Search / selected chip row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                {selectedUser ? (
                  /* Selected user chip */
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', borderRadius: 7,
                    background: 'var(--bg-app)', border: '1.5px solid var(--accent)',
                    fontSize: 13,
                  }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                      {(selectedUser.displayName || selectedUser.email).slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedUser.displayName || selectedUser.email}
                      </div>
                      {selectedUser.displayName && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {selectedUser.email}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={clearSelection}
                      style={{ color: 'var(--text-muted)', fontSize: 14, flexShrink: 0, lineHeight: 1 }}
                      title="Clear selection"
                    >×</button>
                  </div>
                ) : (
                  /* Search input */
                  <input
                    ref={searchRef}
                    className="form-input"
                    type="text"
                    placeholder="Search by full name…"
                    value={search}
                    onChange={e => { setSearch(e.target.value); setStatus(null); }}
                    onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') { setShowDropdown(false); setSearch(''); }
                    }}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    autoComplete="off"
                  />
                )}

                {/* Suggestions dropdown */}
                {showDropdown && suggestions.length > 0 && !selectedUser && (
                  <div
                    ref={dropdownRef}
                    style={{
                      position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 10,
                      background: 'var(--bg-surface)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
                      border: '1px solid var(--border)', overflow: 'hidden',
                    }}
                  >
                    {suggestions.map(profile => (
                      <button
                        key={profile.uid}
                        onClick={() => selectSuggestion(profile)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                          padding: '9px 12px', textAlign: 'left',
                          background: 'transparent',
                          borderBottom: '1px solid var(--border)',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-app)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                          {(profile.displayName || profile.email).slice(0, 2).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {profile.displayName || profile.email}
                          </div>
                          {profile.displayName && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {profile.email}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* No results hint */}
                {showDropdown && suggestions.length === 0 && search.trim().length >= 1 && !selectedUser && (
                  <div
                    ref={dropdownRef}
                    style={{
                      position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 10,
                      background: 'var(--bg-surface)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
                      border: '1px solid var(--border)', padding: '12px 14px',
                      fontSize: 12, color: 'var(--text-muted)',
                    }}
                  >
                    No users found matching "{search.trim()}"
                  </div>
                )}
              </div>

              <button
                className="btn-primary"
                onClick={handleInvite}
                disabled={loading || !selectedUser}
                style={{ opacity: selectedUser ? 1 : 0.45, whiteSpace: 'nowrap' }}
              >
                {loading ? '…' : 'Invite'}
              </button>
            </div>

            {/* Role toggle */}
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
              initials={ownerInitials}
              primaryLabel={ownerLabel}
              secondaryLabel={ownerMember?.displayName ? ownerMember.email : undefined}
              role="owner"
            />

            {/* Non-owner members */}
            {nonOwnerMembers.map(m => {
              const primary   = m.displayName || m.email;
              const secondary = m.displayName ? m.email : undefined;
              return (
                <MemberRow
                  key={m.userId}
                  initials={primary.slice(0, 2).toUpperCase()}
                  primaryLabel={primary}
                  secondaryLabel={secondary}
                  role={m.role}
                  onRoleChange={isOwner ? (r) => handleRoleChange(m, r) : undefined}
                  onRemove={isOwner ? () => handleRemove(m.userId, primary) : undefined}
                />
              );
            })}

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

function MemberRow({ initials, primaryLabel, secondaryLabel, role, onRoleChange, onRemove }: {
  initials: string;
  primaryLabel: string;
  secondaryLabel?: string;
  role: TimelineRole;
  onRoleChange?: (r: 'editor' | 'viewer') => void;
  onRemove?: () => void;
}) {
  const isOwner   = role === 'owner';
  const roleColor = role === 'viewer' ? '#f59e0b' : role === 'editor' ? '#6366f1' : '#22c55e';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-app)' }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: isOwner ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isOwner ? '#fff' : '#64748b', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {primaryLabel}
        </div>
        {secondaryLabel ? (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {secondaryLabel}
          </div>
        ) : (
          <div style={{ fontSize: 10, color: roleColor, fontWeight: 600 }}>{ROLE_LABELS[role]}</div>
        )}
        {secondaryLabel && (
          <div style={{ fontSize: 10, color: roleColor, fontWeight: 600 }}>{ROLE_LABELS[role]}</div>
        )}
      </div>

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
        <button
          onClick={onRemove}
          style={{ fontSize: 11, color: '#ef4444', background: '#fee2e2', padding: '3px 8px', borderRadius: 5, flexShrink: 0 }}
        >
          Remove
        </button>
      )}
    </div>
  );
}
