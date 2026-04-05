import React, { useState, useEffect, useRef } from 'react';
import { useGantt } from '../context/GanttContext';

interface Props {
  defaultProjectId?: string;
  onClose: () => void;
}

export default function AddTaskRowModal({ defaultProjectId, onClose }: Props) {
  const { state, dispatch, genId } = useGantt();
  const [name, setName]           = useState('');
  const [projectId, setProjectId] = useState(defaultProjectId ?? state.projects[0]?.id ?? '');
  const [subgroupId, setSubgroupId] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const availableSubgroups = state.subgroups.filter(s => s.projectId === projectId);
  useEffect(() => { setSubgroupId(''); }, [projectId]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed || !projectId) return;
    dispatch({
      type: 'ADD_TASK_ROW',
      taskRow: {
        id: genId(), userId: '', timelineId: '',
        projectId, subgroupId: subgroupId || null,
        name: trimmed, order: 0,
      },
    });
    onClose();
  }

  const selectedProject = state.projects.find(p => p.id === projectId);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>▬▬ New Task Row</h2>

        <div className="form-group">
          <label className="form-label">Row Name</label>
          <input ref={inputRef} className="form-input"
            placeholder="e.g. Software, Hardware, Testing…"
            value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }} />
        </div>

        <div className="form-group">
          <label className="form-label">Swim Lane (Project)</label>
          <select className="form-input" value={projectId}
            onChange={e => setProjectId(e.target.value)}
            disabled={!!defaultProjectId} style={{ appearance: 'auto' }}>
            {state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {availableSubgroups.length > 0 && (
          <div className="form-group">
            <label className="form-label">Subgroup <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
            <select className="form-input" value={subgroupId}
              onChange={e => setSubgroupId(e.target.value)} style={{ appearance: 'auto' }}>
              <option value="">— Project level —</option>
              {availableSubgroups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {selectedProject && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f3f4f7', marginBottom: 20, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Tasks assigned to <strong>{name || '…'}</strong> will share one calendar row, rendered as stacked bars.
            Tasks without a row get their own independent row as usual.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit}
            disabled={!name.trim() || !projectId}
            style={{ opacity: (name.trim() && projectId) ? 1 : 0.5 }}>
            Create Task Row
          </button>
        </div>
      </div>
    </div>
  );
}
