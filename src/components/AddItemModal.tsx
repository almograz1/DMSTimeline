import React, { useState, useEffect, useRef } from 'react';
import { useGantt } from '../context/GanttContext';
import type { Project } from '../types';

interface Props {
  /** If provided, the project selector is pre-filled and locked */
  defaultProjectId?: string;
  /** Whether we're adding a 'task' or 'milestone' */
  itemType: 'task' | 'milestone';
  onClose: () => void;
}

export default function AddItemModal({ defaultProjectId, itemType, onClose }: Props) {
  const { state, dispatch, genId } = useGantt();
  const [name, setName] = useState('');
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

    if (itemType === 'task') {
      dispatch({
        type: 'ADD_ITEM',
        item: {
          id: genId(),
          type: 'task',
          projectId,
          name: trimmed,
          startDate: null, // Will be set by clicking the calendar
          endDate: null,
        },
      });
    } else {
      dispatch({
        type: 'ADD_ITEM',
        item: {
          id: genId(),
          type: 'milestone',
          projectId,
          name: trimmed,
          date: null, // Will be set by clicking the calendar
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

        {/* Name input */}
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

        {/* Project selector */}
        <div className="form-group">
          <label className="form-label">Swim Lane (Project)</label>
          {state.projects.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              No projects yet — create a swim lane first.
            </p>
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

        {/* Contextual hint explaining what happens after creation */}
        {selectedProject && (
          <div style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: '#f3f4f7',
            marginBottom: 20,
            fontSize: 12,
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}>
            {itemType === 'task' ? (
              <>
                After creating, the task row will appear under{' '}
                <strong style={{ color: selectedProject.color }}>{selectedProject.name}</strong>.
                <br />
                <strong>Click once</strong> in the calendar row to set the start date,
                then <strong>click again</strong> to set the end date.
              </>
            ) : (
              <>
                After creating, the milestone row will appear under{' '}
                <strong style={{ color: selectedProject.color }}>{selectedProject.name}</strong>.
                <br />
                <strong>Click once</strong> in the calendar row to place the milestone.
              </>
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
