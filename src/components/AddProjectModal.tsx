import React, { useState, useEffect, useRef } from 'react';
import { useGantt } from '../context/GanttContext';

// ─── Preset Color Palette ─────────────────────────────────────────────────────
// Curated set of distinguishable colors, similar to TeamGantt's palette.
const PRESET_COLORS = [
  '#4A90D9', '#5B9E6A', '#D95B5B', '#E8A838', '#9B6DD9',
  '#38B2AC', '#E06794', '#3B82F6', '#10B981', '#F59E0B',
  '#8B5CF6', '#EF4444', '#06B6D4', '#84CC16', '#F97316',
  '#EC4899',
];

interface Props {
  onClose: () => void;
}

export default function AddProjectModal({ onClose }: Props) {
  const { dispatch, genId } = useGantt();
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the name field when the modal opens
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Allow closing with Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    dispatch({
      type: 'ADD_PROJECT',
      project: { id: genId(), name: trimmed, color, collapsed: false },
    });
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      {/* Stop click from bubbling to backdrop */}
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>
          New Swim Lane
        </h2>

        {/* Project Name */}
        <div className="form-group">
          <label className="form-label">Project Name</label>
          <input
            ref={inputRef}
            className="form-input"
            placeholder="e.g. Thor SP2 / Hawk SP5"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
          />
        </div>

        {/* Color Picker */}
        <div className="form-group">
          <label className="form-label">Lane Color</label>
          <div className="color-grid">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                className={`color-swatch${color === c ? ' selected' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                title={c}
              />
            ))}
          </div>
        </div>

        {/* Preview */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px',
          borderRadius: 8,
          background: color + '18',
          border: `1.5px solid ${color}40`,
          marginBottom: 20,
        }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: color, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: color, fontSize: 13 }}>
            {name || 'Project preview'}
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={!name.trim()}
            style={{ opacity: name.trim() ? 1 : 0.5 }}
          >
            Create Swim Lane
          </button>
        </div>
      </div>
    </div>
  );
}
