import { useState } from 'react';
import { GanttProvider, useGantt } from './context/GanttContext';
import GanttChart from './components/GanttChart';
import AddProjectModal from './components/AddProjectModal';
import AddItemModal from './components/AddItemModal';
import './index.css';

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function Toolbar({
  onAddProject,
  onAddTask,
  onAddMilestone,
}: {
  onAddProject: () => void;
  onAddTask: () => void;
  onAddMilestone: () => void;
}) {
  const { state, dispatch } = useGantt();
  const { viewMode } = state;
  const hasProjects = state.projects.length > 0;

  const pan = (days: number) => dispatch({ type: 'PAN_CALENDAR', days });

  return (
    <div style={{
      height: 52,
      background: 'var(--bg-toolbar)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 8,
      borderBottom: '1.5px solid rgba(255,255,255,0.06)',
      flexShrink: 0,
      userSelect: 'none',
    }}>
      {/* App logo/title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
        <div style={{
          width: 26, height: 26,
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          borderRadius: 7,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14,
        }}>📊</div>
        <span style={{ color: 'var(--text-inverse)', fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em' }}>
          GanttFlow
        </span>
      </div>

      <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

      <ToolbarButton onClick={onAddProject} icon="＋" label="Swim Lane" accent />
      {hasProjects && (
        <>
          <ToolbarButton onClick={onAddTask}      icon="▬" label="Task" />
          <ToolbarButton onClick={onAddMilestone} icon="◆" label="Milestone" />
        </>
      )}

      <div style={{ flex: 1 }} />

      {/* Calendar navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <ToolbarIconBtn onClick={() => pan(-(viewMode === 'weekly' ? 28 : 14))} title="Back">‹‹</ToolbarIconBtn>
        <ToolbarIconBtn onClick={() => pan(-(viewMode === 'weekly' ? 7  : 1 ))} title="Step back">‹</ToolbarIconBtn>
        <ToolbarIconBtn onClick={() => dispatch({ type: 'GO_TO_TODAY' })} title="Jump to today" label="Today" />
        <ToolbarIconBtn onClick={() => pan(+(viewMode === 'weekly' ? 7  : 1 ))} title="Step forward">›</ToolbarIconBtn>
        <ToolbarIconBtn onClick={() => pan(+(viewMode === 'weekly' ? 28 : 14))} title="Forward">››</ToolbarIconBtn>
      </div>

      <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

      {/* View mode toggle */}
      <div style={{
        display: 'flex',
        background: 'rgba(255,255,255,0.07)',
        borderRadius: 7,
        padding: 2,
        gap: 2,
      }}>
        {(['daily', 'weekly'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', viewMode: mode })}
            style={{
              padding: '4px 12px',
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 600,
              background: viewMode === mode ? 'rgba(255,255,255,0.15)' : 'transparent',
              color: viewMode === mode ? '#fff' : 'var(--toolbar-text)',
              textTransform: 'capitalize',
              transition: 'background 0.15s, color 0.15s',
              letterSpacing: '0.02em',
            }}
          >
            {mode === 'daily' ? '☀ Day' : '📅 Week'}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Toolbar Button Components ────────────────────────────────────────────────

function ToolbarButton({ onClick, icon, label, accent = false }: {
  onClick: () => void;
  icon: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '5px 12px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        background: accent
          ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
          : 'rgba(255,255,255,0.07)',
        color: '#fff',
        border: accent ? 'none' : '1px solid rgba(255,255,255,0.1)',
        transition: 'opacity 0.15s, transform 0.1s',
        letterSpacing: '0.02em',
      }}
      onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
      onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
    >
      <span style={{ fontSize: 11 }}>{icon}</span>
      {label}
    </button>
  );
}

function ToolbarIconBtn({ onClick, title, children, label }: {
  onClick: () => void;
  title: string;
  children?: React.ReactNode;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        minWidth: label ? 54 : 28, height: 28,
        borderRadius: 5,
        background: 'rgba(255,255,255,0.07)',
        color: 'var(--toolbar-text)',
        fontSize: label ? 11 : 16,
        fontWeight: 600,
        transition: 'background 0.12s',
        border: '1px solid rgba(255,255,255,0.08)',
        padding: '0 8px',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.13)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
    >
      {label ?? children}
    </button>
  );
}

// ─── Modal type ───────────────────────────────────────────────────────────────

type ModalType = 'project' | 'task' | 'milestone' | null;

// ─── AppInner ─────────────────────────────────────────────────────────────────

function AppInner() {
  const [modal, setModal] = useState<ModalType>(null);

  // `loading` is true until both Firestore onSnapshot listeners have fired
  // their first snapshot. We block the chart from rendering until data is ready
  // to avoid a flash of empty state on every page load.
  const { loading } = useGantt();

  if (loading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-app)',
        gap: 16,
      }}>
        {/* CSS-only spinner — defined inline to avoid a separate stylesheet */}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{
          width: 36,
          height: 36,
          border: '3px solid var(--border)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 0.7s linear infinite',
        }} />
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          Loading your Gantt chart…
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Toolbar
        onAddProject={() => setModal('project')}
        onAddTask={() => setModal('task')}
        onAddMilestone={() => setModal('milestone')}
      />

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <GanttChart />
      </div>

      {modal === 'project'   && <AddProjectModal onClose={() => setModal(null)} />}
      {modal === 'task'      && <AddItemModal itemType="task"      onClose={() => setModal(null)} />}
      {modal === 'milestone' && <AddItemModal itemType="milestone" onClose={() => setModal(null)} />}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <GanttProvider>
      <AppInner />
    </GanttProvider>
  );
}
