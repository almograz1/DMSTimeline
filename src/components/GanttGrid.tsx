// ─────────────────────────────────────────────────────────────────────────────
// src/components/GanttGrid.tsx
//
// The heart of the app.  Renders:
//   • A single scrollable container (both axes) that holds:
//       – A sticky column header (month + week/day labels)
//       – Per-row pairs of [sidebar cell | calendar cell]
//
// Scrolling strategy
// ──────────────────
// The outer div (.gantt-scroll) is overflow:auto in both directions.
// Inside it, .gantt-table uses min-width:max-content so it grows as wide as
// the calendar needs to be.  Each sidebar cell uses position:sticky;left:0
// so it remains visible during horizontal scrolling, and the header row uses
// position:sticky;top:0 for vertical scrolling.  No JS scroll-sync needed.
//
// Row ordering
// ────────────
// Both the sidebar and the calendar are driven by the same `rows` array from
// GanttContext, guaranteeing pixel-perfect vertical alignment.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useRef } from 'react';
import { useGantt, SWIMLANE_COLORS } from '../store/GanttContext';
import type { GanttRow } from '../types';
import {
  buildColumns,
  buildMonthGroups,
  dateToX,
  xToDate,
  totalCalWidth,
  COL_WIDTH_WEEK,
  COL_WIDTH_DAY,
  PX_PER_DAY_WEEK,
} from '../utils/dateUtils';

// ─── Layout constants ─────────────────────────────────────────────────────────

const ROW_H     = 40;  // height of every row (px)
const SIDEBAR_W = 280; // width of the sticky left sidebar (px)
const MONTH_H   = 22;  // height of the month tier in the header (px)
const WEEK_H    = 30;  // height of the week/day tier in the header (px)
const HEADER_H  = MONTH_H + WEEK_H; // total header height (px)
const DIAMOND   = 14;  // milestone diamond size (px)

// ─── Add-item dialog ──────────────────────────────────────────────────────────

interface AddDialogProps {
  kind: 'task' | 'milestone';
  swimlaneId: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

/** Modal dialog that collects a name before a new task or milestone is created */
function AddItemDialog({ kind, onConfirm, onCancel }: AddDialogProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus when dialog mounts
  React.useEffect(() => { inputRef.current?.focus(); }, []);

  const commit = () => {
    const name = value.trim();
    if (name) onConfirm(name);
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      {/* Stop click from propagating to the overlay (which closes the dialog) */}
      <div className="dialog-box" onClick={e => e.stopPropagation()}>
        <h3 className="dialog-title">New {kind === 'task' ? 'Task' : 'Milestone'}</h3>
        <input
          ref={inputRef}
          className="dialog-input"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter')  commit();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder={kind === 'task' ? 'Task name…' : 'Milestone name…'}
        />
        <p className="dialog-hint">
          {kind === 'task'
            ? 'After confirming, click the task row to set start date, then click again for end date.'
            : 'After confirming, click the milestone row to place the diamond.'}
        </p>
        <div className="dialog-actions">
          <button className="btn-confirm" onClick={commit}>Confirm</button>
          <button className="btn-cancel"  onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Color picker popover ─────────────────────────────────────────────────────

interface ColorPickerProps {
  currentColor: string;
  onChange: (color: string) => void;
  onClose: () => void;
}

function ColorPicker({ currentColor, onChange, onClose }: ColorPickerProps) {
  return (
    <div className="color-picker-popover" onClick={e => e.stopPropagation()}>
      {SWIMLANE_COLORS.map(c => (
        <button
          key={c}
          className={`color-swatch${c === currentColor ? ' selected' : ''}`}
          style={{ backgroundColor: c }}
          onClick={() => { onChange(c); onClose(); }}
          aria-label={c}
        />
      ))}
    </div>
  );
}

// ─── Sidebar cell ─────────────────────────────────────────────────────────────

interface SidebarCellProps {
  row: GanttRow;
  onAddTask:      (swimlaneId: string) => void;
  onAddMilestone: (swimlaneId: string) => void;
  onDelete:       (row: GanttRow) => void;
  onColorChange:  (swimlaneId: string, color: string) => void;
}

function SidebarCell({ row, onAddTask, onAddMilestone, onDelete, onColorChange }: SidebarCellProps) {
  const [hovered,    setHovered]    = useState(false);
  const [showColors, setShowColors] = useState(false);

  // ── Swimlane header row ────────────────────────────────────────────────────
  if (row.kind === 'swimlane') {
    return (
      <div
        className="sidebar-cell swimlane-header-cell"
        style={{ borderLeft: `3px solid ${row.swimlane.color}` }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setShowColors(false); }}
      >
        {/* Color dot — click to open color picker */}
        <button
          className="color-dot-btn"
          style={{ backgroundColor: row.swimlane.color }}
          onClick={() => setShowColors(v => !v)}
          title="Change color"
        />
        {showColors && (
          <ColorPicker
            currentColor={row.swimlane.color}
            onChange={color => onColorChange(row.swimlane.id, color)}
            onClose={() => setShowColors(false)}
          />
        )}

        <span className="cell-name swimlane-name">{row.swimlane.name}</span>

        {/* Action buttons, visible on hover */}
        {hovered && (
          <div className="cell-actions">
            <button className="action-btn" title="Add Task"
              onClick={() => onAddTask(row.swimlane.id)}>+T</button>
            <button className="action-btn" title="Add Milestone"
              onClick={() => onAddMilestone(row.swimlane.id)}>+M</button>
            <button className="action-btn danger" title="Delete swimlane"
              onClick={() => onDelete(row)}>✕</button>
          </div>
        )}
      </div>
    );
  }

  // ── Task row ───────────────────────────────────────────────────────────────
  if (row.kind === 'task') {
    const isPending = row.task.status !== 'placed';
    return (
      <div
        className={`sidebar-cell task-cell${isPending ? ' pending' : ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Colored dot matching the parent swimlane */}
        <span className="cell-dot" style={{ backgroundColor: row.swimlane.color }} />
        <span className="cell-name">{row.task.name}</span>

        {/* Contextual hint shown while the task is awaiting placement */}
        {isPending && (
          <span className="pending-hint">
            {row.task.status === 'pending-start' ? '← set start' : '← set end'}
          </span>
        )}

        {hovered && !isPending && (
          <button className="action-btn danger small" onClick={() => onDelete(row)}>✕</button>
        )}
      </div>
    );
  }

  // ── Milestone row ──────────────────────────────────────────────────────────
  if (row.kind === 'milestone') {
    const isPending = row.milestone.status === 'pending';
    return (
      <div
        className={`sidebar-cell milestone-cell${isPending ? ' pending' : ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Rotated square = diamond shape */}
        <span className="cell-diamond" style={{ backgroundColor: row.swimlane.color }} />
        <span className="cell-name">{row.milestone.name}</span>

        {isPending && <span className="pending-hint">← click to place</span>}

        {hovered && !isPending && (
          <button className="action-btn danger small" onClick={() => onDelete(row)}>✕</button>
        )}
      </div>
    );
  }

  return null;
}

// ─── Calendar row ─────────────────────────────────────────────────────────────

interface CalRowProps {
  row:        GanttRow;
  viewStart:  string;
  viewMode:   import('../types').ViewMode;
  totalW:     number;   // total calendar canvas width in px
  hoverDate:  string | null;
  onCellClick: (row: GanttRow, date: string) => void;
  onCellHover: (row: GanttRow, date: string | null) => void;
}

function CalRow({ row, viewStart, viewMode, totalW, hoverDate, onCellClick, onCellHover }: CalRowProps) {
  const pxPerDay = viewMode === 'week' ? PX_PER_DAY_WEEK : COL_WIDTH_DAY;

  /**
   * Whether this row is currently "interactive" — i.e. waiting for a click
   * to complete task/milestone placement.
   */
  const isInteractive =
    (row.kind === 'task' && row.task.status !== 'placed') ||
    (row.kind === 'milestone' && row.milestone.status === 'pending');

  /** Convert a MouseEvent's X position within the row to a date string */
  const eventToDate = (e: React.MouseEvent<HTMLDivElement>): string => {
    const rect = e.currentTarget.getBoundingClientRect();
    return xToDate(e.clientX - rect.left, viewStart, viewMode);
  };

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isInteractive) onCellHover(row, eventToDate(e));
  }, [isInteractive, viewStart, viewMode, row]);                  // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseLeave = useCallback(() => {
    if (isInteractive) onCellHover(row, null);
  }, [isInteractive, row]);                                       // eslint-disable-line react-hooks/exhaustive-deps

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isInteractive) onCellClick(row, eventToDate(e));
  }, [isInteractive, viewStart, viewMode, row]);                  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Swimlane header: colored background stripe ─────────────────────────────
  if (row.kind === 'swimlane') {
    return (
      <div
        className="cal-row swimlane-stripe"
        style={{ width: totalW, backgroundColor: row.swimlane.color + '15' }}
      />
    );
  }

  // ── Task row ───────────────────────────────────────────────────────────────
  if (row.kind === 'task') {
    const { task, swimlane } = row;

    // Calculate placed bar geometry
    let barLeft = 0, barWidth = 0;
    if (task.status === 'placed' && task.startDate && task.endDate) {
      barLeft  = dateToX(task.startDate, viewStart, viewMode);
      // +1 day so the end date is inclusive (a one-day task has visible width)
      barWidth = Math.max(
        dateToX(task.endDate, viewStart, viewMode) - barLeft + pxPerDay,
        pxPerDay,
      );
    }

    // Ghost bar: visible while user is choosing the end date
    let ghostLeft = 0, ghostWidth = 0, showGhost = false;
    if (task.status === 'pending-end' && task.startDate && hoverDate) {
      const sx = dateToX(task.startDate, viewStart, viewMode);
      const hx = dateToX(hoverDate, viewStart, viewMode) + pxPerDay;
      if (hx > sx) {
        ghostLeft  = sx;
        ghostWidth = hx - sx;
        showGhost  = true;
      }
    }

    return (
      <div
        className={`cal-row task-cal-row${isInteractive ? ' interactive' : ''}`}
        style={{ width: totalW }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {/* Subtle alternating background */}
        <div className="row-bg" />

        {/* Start-date pin: shown after first click while waiting for end date */}
        {task.status === 'pending-end' && task.startDate && (
          <div
            className="start-pin"
            style={{
              left: dateToX(task.startDate, viewStart, viewMode),
              backgroundColor: swimlane.color,
            }}
          />
        )}

        {/* Ghost bar preview */}
        {showGhost && (
          <div
            className="ghost-bar"
            style={{
              left:            ghostLeft,
              width:           ghostWidth,
              backgroundColor: swimlane.color + '40',
              borderColor:     swimlane.color,
            }}
          />
        )}

        {/* Placed task bar */}
        {task.status === 'placed' && (
          <div
            className="task-bar"
            style={{
              left:            barLeft,
              width:           barWidth,
              backgroundColor: swimlane.color,
            }}
          >
            <span className="bar-label">{task.name}</span>
          </div>
        )}
      </div>
    );
  }

  // ── Milestone row ──────────────────────────────────────────────────────────
  if (row.kind === 'milestone') {
    const { milestone, swimlane } = row;
    const markerX = milestone.date
      ? dateToX(milestone.date, viewStart, viewMode) - DIAMOND / 2
      : null;

    // Ghost diamond while hovering
    const ghostX = milestone.status === 'pending' && hoverDate
      ? dateToX(hoverDate, viewStart, viewMode) - DIAMOND / 2
      : null;

    return (
      <div
        className={`cal-row milestone-cal-row${isInteractive ? ' interactive' : ''}`}
        style={{ width: totalW }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        <div className="row-bg" />

        {/* Ghost diamond shown while hovering in pending state */}
        {ghostX !== null && (
          <div
            className="milestone-ghost"
            style={{
              left:            ghostX,
              backgroundColor: swimlane.color + '55',
              width:           DIAMOND,
              height:          DIAMOND,
            }}
          />
        )}

        {/* Placed diamond */}
        {markerX !== null && (
          <div
            className="milestone-diamond"
            style={{
              left:            markerX,
              backgroundColor: swimlane.color,
              width:           DIAMOND,
              height:          DIAMOND,
            }}
            title={milestone.name}
          />
        )}
      </div>
    );
  }

  return null;
}

// ─── Calendar header ──────────────────────────────────────────────────────────

interface CalHeaderProps {
  viewStart: string;
  viewMode:  import('../types').ViewMode;
  viewDays:  number;
  totalW:    number;
}

/**
 * Two-tier header matching TeamGantt's layout:
 *   Top tier   — month names spanning their respective columns
 *   Bottom tier — week numbers + date range (or day name + number in day view)
 */
function CalHeader({ viewStart, viewMode, viewDays, totalW }: CalHeaderProps) {
  const cols   = buildColumns(viewStart, viewDays, viewMode);
  const months = buildMonthGroups(cols);

  return (
    <div className="cal-header" style={{ width: totalW }}>
      {/* Month tier */}
      <div className="cal-header-months" style={{ height: MONTH_H, position: 'relative' }}>
        {months.map(m => (
          <div
            key={m.key}
            className="month-label"
            style={{ left: m.offsetPx, width: m.widthPx, height: MONTH_H }}
          >
            {m.label}
          </div>
        ))}
      </div>

      {/* Week / Day tier */}
      <div className="cal-header-cols" style={{ height: WEEK_H, position: 'relative' }}>
        {cols.map(col => (
          <div
            key={col.key}
            className="col-header"
            style={{ left: col.offsetPx, width: col.widthPx, height: WEEK_H }}
          >
            <span className="col-label1">{col.label1}</span>
            <span className="col-label2">{col.label2}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── GanttGrid (root export) ──────────────────────────────────────────────────

export function GanttGrid() {
  const { state, dispatch, rows } = useGantt();
  const { viewStart, viewMode, viewDays, hoverDate } = state;

  // ── Pending dialog state ──────────────────────────────────────────────────
  const [dialog, setDialog] = useState<{
    kind: 'task' | 'milestone';
    swimlaneId: string;
  } | null>(null);

  // ── Computed values ───────────────────────────────────────────────────────
  const cols  = buildColumns(viewStart, viewDays, viewMode);
  const totalW = totalCalWidth(cols);

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * Called when a user clicks inside a calendar row.
   * Routes to the correct placement action based on the row's current status.
   */
  const handleCellClick = useCallback((row: GanttRow, date: string) => {
    if (row.kind === 'task') {
      const { task } = row;
      if (task.status === 'pending-start') {
        dispatch({ type: 'SET_TASK_START', taskId: task.id, startDate: date });
      } else if (task.status === 'pending-end' && task.startDate) {
        // Guard: end date must be on or after start date
        if (date >= task.startDate) {
          dispatch({ type: 'SET_TASK_END', taskId: task.id, endDate: date });
        }
        // If the click is before startDate, do nothing — the user can try again
      }
    } else if (row.kind === 'milestone' && row.milestone.status === 'pending') {
      dispatch({ type: 'PLACE_MILESTONE', milestoneId: row.milestone.id, date });
    }
  }, [dispatch]);

  /** Tracks the mouse position in interactive rows for ghost preview */
  const handleCellHover = useCallback((_row: GanttRow, date: string | null) => {
    dispatch({ type: 'SET_HOVER_DATE', date });
  }, [dispatch]);

  /** Deletes a swimlane, task, or milestone */
  const handleDelete = useCallback((row: GanttRow) => {
    if (row.kind === 'swimlane')  dispatch({ type: 'DELETE_SWIMLANE',  id: row.swimlane.id });
    if (row.kind === 'task')      dispatch({ type: 'DELETE_TASK',       id: row.task.id });
    if (row.kind === 'milestone') dispatch({ type: 'DELETE_MILESTONE',  id: row.milestone.id });
  }, [dispatch]);

  /** Commits a new task or milestone after the user enters a name */
  const handleDialogConfirm = useCallback((name: string) => {
    if (!dialog) return;
    if (dialog.kind === 'task') {
      dispatch({ type: 'ADD_TASK', swimlaneId: dialog.swimlaneId, name });
    } else {
      dispatch({ type: 'ADD_MILESTONE', swimlaneId: dialog.swimlaneId, name });
    }
    setDialog(null);
  }, [dialog, dispatch]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="gantt-outer">
      {/* ── Add item dialog (modal overlay) ──────────────────────────────── */}
      {dialog && (
        <AddItemDialog
          kind={dialog.kind}
          swimlaneId={dialog.swimlaneId}
          onConfirm={handleDialogConfirm}
          onCancel={() => setDialog(null)}
        />
      )}

      {/* ── Main scrollable container ─────────────────────────────────────── */}
      <div className="gantt-scroll">

        {/* 
          .gantt-table uses min-width:max-content so horizontal scrolling works.
          All rows share the same structure: [sidebar cell | calendar cell].
        */}
        <div className="gantt-table">

          {/* ── Sticky header row ─────────────────────────────────────────── */}
          <div className="gantt-head-row" style={{ height: HEADER_H }}>
            {/* Sidebar column header (sticky left + sticky top) */}
            <div className="sidebar-header" style={{ width: SIDEBAR_W }}>
              <span className="sidebar-header-label">PROJECT / TASK</span>
            </div>
            {/* Calendar column headers */}
            <CalHeader
              viewStart={viewStart}
              viewMode={viewMode}
              viewDays={viewDays}
              totalW={totalW}
            />
          </div>

          {/* ── Body rows ─────────────────────────────────────────────────── */}
          {rows.map(row => {
            // Unique stable key for React's reconciler
            const key =
              row.kind === 'swimlane' ? `sl-${row.swimlane.id}`  :
              row.kind === 'task'     ? `t-${row.task.id}`        :
                                        `m-${row.milestone.id}`;

            /*
             * Pass hoverDate only to the row that's actively awaiting placement.
             * This prevents ghost previews from appearing on every row
             * when the mouse moves.
             */
            const rowHoverDate =
              (row.kind === 'task'      && row.task.status === 'pending-end') ||
              (row.kind === 'milestone' && row.milestone.status === 'pending')
                ? hoverDate
                : null;

            return (
              <div key={key} className="gantt-body-row" style={{ height: ROW_H }}>
                <SidebarCell
                  row={row}
                  onAddTask={id      => setDialog({ kind: 'task',      swimlaneId: id })}
                  onAddMilestone={id => setDialog({ kind: 'milestone', swimlaneId: id })}
                  onDelete={handleDelete}
                  onColorChange={(id, color) =>
                    dispatch({ type: 'CHANGE_SWIMLANE_COLOR', id, color })
                  }
                />
                <CalRow
                  row={row}
                  viewStart={viewStart}
                  viewMode={viewMode}
                  totalW={totalW}
                  hoverDate={rowHoverDate}
                  onCellClick={handleCellClick}
                  onCellHover={handleCellHover}
                />
              </div>
            );
          })}

          {/* ── Empty state ────────────────────────────────────────────────── */}
          {rows.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">◈</div>
              <p className="empty-title">No projects yet</p>
              <p className="empty-sub">Click <strong>+ New Swimlane</strong> in the toolbar to add your first project.</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
