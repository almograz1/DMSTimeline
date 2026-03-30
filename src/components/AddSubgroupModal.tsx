import React, { useState, useEffect, useRef } from 'react';
import { useGantt } from '../context/GanttContext';

interface Props {
  defaultProjectId?: string;
  onClose: () => void;
}

export default function AddSubgroupModal({ defaultProjectId, onClose }: Props) {
  const { state, dispatch, genId } = useGantt();
  const [name, setName]           = useState('');
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
      type: 'ADD_SUBGROUP',
      subgroup: {
        id: genId(),
        projectId,
        name: trimmed,
        collapsed: false,
        order: 0,
      },
    });
    onClose();
  }

  const selectedProject = state.projects.find(p => p.id === projectId);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>▤ New Subgroup</h2>

        <div className="form-group">
          <label className="form-label">Subgroup Name</label>
          <input
            ref={inputRef}
            className="form-input"
            placeholder="e.g. Backend, Phase 1, Testing…"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
          />
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
            The subgroup will appear as a collapsible section inside{' '}
            <strong style={{ color: selectedProject.color }}>{selectedProject.name}</strong>.
            Tasks and milestones can then be assigned to it.
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
            Create Subgroup
          </button>
        </div>
      </div>
    </div>
  );
}
