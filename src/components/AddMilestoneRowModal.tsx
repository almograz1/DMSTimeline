import React, { useState, useEffect, useRef } from 'react';
import { useGantt } from '../context/GanttContext';

const ICONS = [
  { icon: '◆', label: 'Diamond (default)' },
  { icon: '🚩', label: 'Flag' },
  { icon: '⭐', label: 'Star' },
  { icon: '●', label: 'Circle' },
  { icon: '⚡', label: 'Lightning' },
  { icon: '🔷', label: 'Blue Diamond' },
  { icon: '🎯', label: 'Target' },
  { icon: '🔔', label: 'Bell' },
  { icon: '✅', label: 'Check' },
  { icon: '🔑', label: 'Key' },
];

interface Props {
  defaultProjectId?: string;
  onClose: () => void;
}

export default function AddMilestoneRowModal({ defaultProjectId, onClose }: Props) {
  const { state, dispatch, genId } = useGantt();
  const [name, setName]         = useState('');
  const [icon, setIcon]         = useState('◆');
  const [projectId, setProjectId] = useState(defaultProjectId ?? state.projects[0]?.id ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed || !projectId) return;
    dispatch({
      type: 'ADD_MILESTONE_ROW',
      milestoneRow: {
        id: genId(), userId: '', timelineId: '',
        projectId, name: trimmed, icon, order: 0,
      },
    });
    onClose();
  }

  const selectedProject = state.projects.find(p => p.id === projectId);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>◆ New Milestone Row</h2>

        <div className="form-group">
          <label className="form-label">Row Name</label>
          <input
            ref={inputRef}
            className="form-input"
            placeholder="e.g. WIP, Release, Gate, Review…"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
          />
        </div>

        {/* Icon picker */}
        <div className="form-group">
          <label className="form-label">Icon</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ICONS.map(({ icon: ic, label }) => (
              <button
                key={ic}
                title={label}
                onClick={() => setIcon(ic)}
                style={{
                  width: 40, height: 40, borderRadius: 8, fontSize: 18,
                  border: icon === ic ? '2.5px solid var(--accent)' : '1.5px solid var(--border)',
                  background: icon === ic ? 'var(--accent-light)' : 'var(--bg-app)',
                  transform: icon === ic ? 'scale(1.1)' : 'scale(1)',
                  transition: 'all 0.1s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {ic}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Swim Lane (Project)</label>
          {state.projects.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>No projects yet.</p>
          ) : (
            <select
              className="form-input"
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              disabled={!!defaultProjectId}
              style={{ appearance: 'auto' }}
            >
              {state.projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>

        {selectedProject && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f3f4f7', marginBottom: 20, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            A new <strong>{icon} {name || '…'}</strong> milestone row will appear inside{' '}
            <strong style={{ color: selectedProject.color }}>{selectedProject.name}</strong>.
            When adding milestones you can assign them to this row.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={!name.trim() || !projectId}
            style={{ opacity: (name.trim() && projectId) ? 1 : 0.5 }}
          >
            Create Row
          </button>
        </div>
      </div>
    </div>
  );
}
