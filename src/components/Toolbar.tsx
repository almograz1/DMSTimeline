// ─────────────────────────────────────────────────────────────────────────────
// src/components/Toolbar.tsx
//
// Top navigation bar. Handles:
//   • Brand/logo
//   • Prev / Next calendar navigation buttons
//   • Week / Day view toggle
//   • "New Swimlane" inline-input form
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useRef, useEffect } from 'react';
import { useGantt, SWIMLANE_COLORS } from '../store/GanttContext';

export function Toolbar() {
  const { state, dispatch } = useGantt();
  const [addingLane, setAddingLane] = useState(false);
  const [laneName, setLaneName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input when the "New Swimlane" form opens
  useEffect(() => {
    if (addingLane) inputRef.current?.focus();
  }, [addingLane]);

  /** Commit the new swimlane (auto-pick next color from palette) */
  const commitAdd = () => {
    const name = laneName.trim();
    if (!name) { setAddingLane(false); return; }
    const color = SWIMLANE_COLORS[state.swimlanes.length % SWIMLANE_COLORS.length];
    dispatch({ type: 'ADD_SWIMLANE', name, color });
    setLaneName('');
    setAddingLane(false);
  };

  /**
   * Navigate the calendar forward or backward.
   * In week mode we jump 4 weeks at a time (28 days) so columns stay aligned.
   * In day mode we jump 7 days at a time.
   */
  const navigate = (dir: 'prev' | 'next') => {
    const jump = state.viewMode === 'week' ? 28 : 7;
    dispatch({ type: 'NAVIGATE', deltaDays: dir === 'next' ? jump : -jump });
  };

  return (
    <header className="toolbar">
      {/* ── Brand ─────────────────────────────────────────────────────────── */}
      <div className="toolbar-brand">
        <span className="brand-glyph">◈</span>
        <span className="brand-text">GanttFlow</span>
      </div>

      <div className="toolbar-divider" />

      {/* ── Navigation ────────────────────────────────────────────────────── */}
      <div className="toolbar-nav">
        <button className="nav-btn" onClick={() => navigate('prev')} title="Previous">
          ‹
        </button>
        <button className="nav-btn" onClick={() => navigate('next')} title="Next">
          ›
        </button>
      </div>

      {/* ── View mode toggle ──────────────────────────────────────────────── */}
      <div className="view-toggle" role="group" aria-label="Calendar view">
        <button
          className={`view-btn${state.viewMode === 'week' ? ' active' : ''}`}
          onClick={() => dispatch({ type: 'SET_VIEW_MODE', mode: 'week' })}
        >
          Week
        </button>
        <button
          className={`view-btn${state.viewMode === 'day' ? ' active' : ''}`}
          onClick={() => dispatch({ type: 'SET_VIEW_MODE', mode: 'day' })}
        >
          Day
        </button>
      </div>

      {/* Spacer pushes the swimlane button to the right */}
      <div style={{ flex: 1 }} />

      {/* ── New swimlane ──────────────────────────────────────────────────── */}
      {addingLane ? (
        <div className="toolbar-input-row">
          <input
            ref={inputRef}
            className="toolbar-input"
            value={laneName}
            onChange={e => setLaneName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter')  commitAdd();
              if (e.key === 'Escape') { setAddingLane(false); setLaneName(''); }
            }}
            placeholder="Swimlane name…"
          />
          <button className="btn-confirm" onClick={commitAdd}>Add</button>
          <button
            className="btn-cancel"
            onClick={() => { setAddingLane(false); setLaneName(''); }}
          >
            ✕
          </button>
        </div>
      ) : (
        <button className="btn-new-lane" onClick={() => setAddingLane(true)}>
          <span className="btn-plus">+</span> New Swimlane
        </button>
      )}
    </header>
  );
}
