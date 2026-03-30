import React, { useState, useEffect, useRef } from 'react';
import { useGantt } from '../context/GanttContext';
import type { Project } from '../types';

interface Props {
  defaultProjectId?: string;
  itemType: 'task' | 'milestone';
  onClose: () => void;
}

export default function AddItemModal({ defaultProjectId, itemType, onClose }: Props) {
  const { state, dispatch, genId } = useGantt();
  const [name, setName]           = useState('');
  const [projectId, setProjectId] = useState(defaultProjectId ?? state.projects[0]?.id ?? '');
  const [subgroupId, setSubgroupId] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Subgroups that belong to the currently selected project
  const availableSubgroups = state.subgroups.filter(s => s.projectId === projectId);

  // Reset subgroup selection when project changes
  useEffect(() => { setSubgroupId(''); }, [projectId]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed || !projectId) return;

    const sgId = subgroupId || null;

    if (itemType === 'task') {
      dispatch({
        type: 'ADD_ITEM',
        item: {
          id: genId(), type: 'task',
          projectId, subgroupId: sgId,
          name: trimmed,
          startDate: null, endDate: null,
          order: 0, // will be overwritten by dispatchWithSync
        },
      });
    } else {
      dispatch({
        type: 'ADD_ITEM',
        item: {
          id: genId(), type: 'milestone',
          projectId, subgroupId: sgId,
          name: trimmed,
          date: null,
          order: 0,
        },
      });
    }
    onClose();
  }

  const selectedProject = state.projects.find(p => p.id === projectId);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>
          {itemType === 'task' ? '📋 New Task' : '🔷 New Milestone'}
        </h2>

        <div className="form-group">
          <label className="form-label">
            {itemType === 'task' ? 'Task Name' : 'Milestone Name'}
          </label>
          <input
            ref={inputRef}
            className="form-input"
            placeholder={itemType === 'task' ? 'e.g. WIP 48 Verification' : 'e.g. Design Freeze'}
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
              {state.projects.map((p: Project) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Subgroup selector — only shown if the selected project has subgroups */}
        {availableSubgroups.length > 0 && (
          <div className="form-group">
            <label className="form-label">Subgroup <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
            <select
              className="form-input"
              value={subgroupId}
              onChange={e => setSubgroupId(e.target.value)}
              style={{ appearance: 'auto' }}
            >
              <option value="">— No subgroup (top-level) —</option>
              {availableSubgroups.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

        {selectedProject && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, background: '#f3f4f7',
            marginBottom: 20, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
          }}>
            {itemType === 'task' ? (
              <>
                After creating, click once in the calendar row to set the start date,
                then click again to set the end date.
              </>
            ) : (
              <>After creating, click once in the calendar row to place the milestone.</>
            )}
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
            Create {itemType === 'task' ? 'Task' : 'Milestone'}
          </button>
        </div>
      </div>
    </div>
  );
}
