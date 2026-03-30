import React, { useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { TimelineProvider, useTimeline } from './auth/TimelineContext';
import { GanttProvider, useGantt } from './context/GanttContext';
import GanttChart from './components/GanttChart';
import AddProjectModal from './components/AddProjectModal';
import AddItemModal from './components/AddItemModal';
import AddSubgroupModal from './components/AddSubgroupModal';
import LoginPage from './auth/LoginPage';
import './index.css';

// ─── Timeline Selector + Create ───────────────────────────────────────────────

function TimelineSelector() {
  const { timelines, activeTimeline, setActiveTimelineId, createTimeline, deleteTimeline } = useTimeline();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState('');

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    await createTimeline(name);
    setNewName('');
    setCreating(false);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {/* Timeline dropdown */}
      <select
        value={activeTimeline?.id ?? ''}
        onChange={e => setActiveTimelineId(e.target.value)}
        style={{
          background: 'rgba(255,255,255,0.1)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 6,
          padding: '4px 8px',
          fontSize: 12,
          fontWeight: 600,
          maxWidth: 160,
        }}
      >
        {timelines.length === 0 && <option value="">No timelines yet</option>}
        {timelines.map(t => (
          <option key={t.id} value={t.id} style={{ background: '#1e1e2e', color: '#fff' }}>
            {t.name}
          </option>
        ))}
      </select>

      {/* Delete current timeline */}
      {activeTimeline && timelines.length > 1 && (
        <button
          title="Delete this timeline"
          onClick={() => {
            if (confirm(`Delete timeline "${activeTimeline.name}"? All its data will be lost.`)) {
              deleteTimeline(activeTimeline.id);
            }
          }}
          style={{ width: 22, height: 22, borderRadius: 5, background: '#fee2e235', color: '#fca5a5', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >×</button>
      )}

      {/* Create new timeline */}
      {creating ? (
        <>
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
            placeholder="Timeline name…"
            style={{
              background: 'rgba(255,255,255,0.12)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6,
              padding: '4px 8px', fontSize: 12, width: 130,
            }}
          />
          <button onClick={handleCreate} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, background: '#6366f1', color: '#fff', fontWeight: 600 }}>Add</button>
          <button onClick={() => setCreating(false)} style={{ fontSize: 12, color: 'var(--toolbar-text)' }}>✕</button>
        </>
      ) : (
        <button
          onClick={() => setCreating(true)}
          title="New timeline"
          style={{ width: 22, height: 22, borderRadius: 5, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >＋</button>
      )}
    </div>
  );
}

// ─── User Menu ────────────────────────────────────────────────────────────────

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen]  = useState(false);

  if (!user) return null;

  const displayName = user.displayName ?? user.email ?? 'User';
  const initials    = displayName.slice(0, 2).toUpperCase();

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={displayName}
        style={{
          width: 30, height: 30, borderRadius: '50%',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          color: '#fff', fontSize: 11, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '2px solid rgba(255,255,255,0.2)',
        }}
      >
        {user.photoURL
          ? <img src={user.photoURL} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
          : initials}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', right: 0, top: 38, zIndex: 100,
            background: 'var(--bg-surface)', borderRadius: 10, padding: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)', border: '1px solid var(--border)',
            minWidth: 200,
          }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{displayName}</p>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>{user.email}</p>
            <button
              onClick={() => { logout(); setOpen(false); }}
              style={{ width: '100%', padding: '8px 0', borderRadius: 7, background: '#fee2e2', color: '#ef4444', fontSize: 12, fontWeight: 600 }}
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function Toolbar({ onAddProject, onAddSubgroup, onAddTask, onAddMilestone }: {
  onAddProject: () => void; onAddSubgroup: () => void;
  onAddTask: () => void; onAddMilestone: () => void;
}) {
  const { state, dispatch } = useGantt();
  const { viewMode }        = state;
  const hasProjects         = state.projects.length > 0;
  const pan = (days: number) => dispatch({ type: 'PAN_CALENDAR', days });

  return (
    <div style={{
      height: 52, background: 'var(--bg-toolbar)',
      display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8,
      borderBottom: '1.5px solid rgba(255,255,255,0.06)', flexShrink: 0, userSelect: 'none',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 4 }}>
        <div style={{ width: 26, height: 26, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📊</div>
        <span style={{ color: 'var(--text-inverse)', fontWeight: 700, fontSize: 13, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>DMS Timeline Gantt</span>
      </div>

      <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />

      {/* Timeline selector */}
      <TimelineSelector />

      <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />

      {/* Add buttons */}
      <TBtn onClick={onAddProject}  icon="＋" label="Swim Lane" accent />
      {hasProjects && (
        <>
          <TBtn onClick={onAddSubgroup} icon="▤" label="Subgroup" />
          <TBtn onClick={onAddTask}     icon="▬" label="Task" />
          <TBtn onClick={onAddMilestone} icon="◆" label="Milestone" />
        </>
      )}

      <div style={{ flex: 1 }} />

      {/* Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <TIconBtn onClick={() => pan(-(viewMode === 'weekly' ? 28 : 14))}>‹‹</TIconBtn>
        <TIconBtn onClick={() => pan(-(viewMode === 'weekly' ? 7  : 1 ))}>‹</TIconBtn>
        <TIconBtn onClick={() => dispatch({ type: 'GO_TO_TODAY' })} label="Today" />
        <TIconBtn onClick={() => pan(+(viewMode === 'weekly' ? 7  : 1 ))}>›</TIconBtn>
        <TIconBtn onClick={() => pan(+(viewMode === 'weekly' ? 28 : 14))}>››</TIconBtn>
      </div>

      <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

      {/* View toggle */}
      <div style={{ display: 'flex', background: 'rgba(255,255,255,0.07)', borderRadius: 7, padding: 2, gap: 2 }}>
        {(['daily', 'weekly'] as const).map(mode => (
          <button key={mode} onClick={() => dispatch({ type: 'SET_VIEW_MODE', viewMode: mode })}
            style={{ padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
              background: viewMode === mode ? 'rgba(255,255,255,0.15)' : 'transparent',
              color: viewMode === mode ? '#fff' : 'var(--toolbar-text)', transition: 'background 0.15s',
            }}>
            {mode === 'daily' ? '☀ Day' : '📅 Week'}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
      <UserMenu />
    </div>
  );
}

function TBtn({ onClick, icon, label, accent = false }: { onClick: () => void; icon: string; label: string; accent?: boolean }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6,
      fontSize: 11, fontWeight: 600,
      background: accent ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(255,255,255,0.07)',
      color: '#fff', border: accent ? 'none' : '1px solid rgba(255,255,255,0.1)',
    }}>
      <span style={{ fontSize: 10 }}>{icon}</span>{label}
    </button>
  );
}

function TIconBtn({ onClick, label, children }: { onClick: () => void; label?: string; children?: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      minWidth: label ? 48 : 26, height: 26, borderRadius: 5,
      background: 'rgba(255,255,255,0.07)', color: 'var(--toolbar-text)',
      fontSize: label ? 11 : 15, fontWeight: 600,
      border: '1px solid rgba(255,255,255,0.08)', padding: '0 6px',
    }}>
      {label ?? children}
    </button>
  );
}

// ─── Empty State (no timelines yet) ──────────────────────────────────────────

function NoTimelines() {
  const { createTimeline, setActiveTimelineId } = useTimeline();
  const [name, setName]    = useState('');

  async function handleCreate() {
    const n = name.trim() || 'My Timeline';
    const id = await createTimeline(n);
    // Optimistically activate the new timeline immediately — the onSnapshot
    // listener will confirm it shortly, but this prevents the UI from staying
    // on the empty state while waiting for Firestore to echo back.
    setActiveTimelineId(id);
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 48 }}>📅</div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>No timelines yet</p>
        <p style={{ fontSize: 14 }}>Create your first timeline to get started.</p>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          placeholder="Timeline name (e.g. Q2 Roadmap)"
          className="form-input"
          style={{ width: 240 }}
        />
        <button onClick={handleCreate} className="btn-primary">Create</button>
      </div>
    </div>
  );
}

// ─── Main App Inner ───────────────────────────────────────────────────────────

type ModalType = 'project' | 'subgroup' | 'task' | 'milestone' | null;

function AppInner() {
  const [modal, setModal]           = useState<ModalType>(null);
  const { loading: ganttLoading }   = useGantt();
  const { loading: tlLoading, activeTimeline } = useTimeline();

  const loading = ganttLoading || tlLoading;

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app)', gap: 16 }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading…</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Toolbar
        onAddProject={() => setModal('project')}
        onAddSubgroup={() => setModal('subgroup')}
        onAddTask={() => setModal('task')}
        onAddMilestone={() => setModal('milestone')}
      />

      {!activeTimeline ? <NoTimelines /> : (
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          <GanttChart />
        </div>
      )}

      {modal === 'project'   && <AddProjectModal onClose={() => setModal(null)} />}
      {modal === 'subgroup'  && <AddSubgroupModal onClose={() => setModal(null)} />}
      {modal === 'task'      && <AddItemModal itemType="task"      onClose={() => setModal(null)} />}
      {modal === 'milestone' && <AddItemModal itemType="milestone" onClose={() => setModal(null)} />}
    </div>
  );
}

// ─── Root with Auth Gate ──────────────────────────────────────────────────────

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app)' }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <TimelineProvider>
      <GanttProvider>
        <AppInner />
      </GanttProvider>
    </TimelineProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
