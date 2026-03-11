// ─────────────────────────────────────────────────────────────────────────────
// src/store/GanttContext.tsx
//
// Global application state managed with React's built-in useReducer.
// No external state library needed — the data model is straightforward.
//
// Architecture:
//   GanttProvider  →  wraps the app, owns all state
//   useGantt()     →  hook that any component uses to read state / dispatch
// ─────────────────────────────────────────────────────────────────────────────

import React, { createContext, useContext, useReducer } from 'react';
import type { Swimlane, Task, Milestone, GanttRow, ViewMode } from '../types';
import { today, weekStart, addDays } from '../utils/dateUtils';

// ─── Preset swimlane color palette ───────────────────────────────────────────

/**
 * Eight distinct colors automatically cycled through as swimlanes are added.
 * The user can later change a swimlane's color via the color picker in the sidebar.
 */
export const SWIMLANE_COLORS: string[] = [
  '#4f8ef7', // cobalt blue
  '#f0855a', // warm orange
  '#54c47a', // emerald green
  '#a96ff7', // violet
  '#f0c040', // golden yellow
  '#f46b6b', // coral red
  '#34cfe0', // sky cyan
  '#f04faa', // rose pink
];

// ─── State shape ──────────────────────────────────────────────────────────────

interface GanttState {
  swimlanes: Swimlane[];
  tasks: Task[];
  milestones: Milestone[];
  viewMode: ViewMode;
  /** YYYY-MM-DD of the leftmost day in the calendar canvas.
   *  Always a Monday in week mode; any day in day mode. */
  viewStart: string;
  /** Total number of days the calendar canvas spans (default: 84 = 12 weeks) */
  viewDays: number;
  /**
   * The date (YYYY-MM-DD) the user is currently hovering over in the calendar.
   * Used exclusively to render the ghost-bar preview while a task is
   * waiting for its end-date click (status = 'pending-end').
   */
  hoverDate: string | null;
}

// ─── Discriminated-union of all possible state mutations ─────────────────────

type Action =
  | { type: 'ADD_SWIMLANE';        name: string; color: string }
  | { type: 'DELETE_SWIMLANE';     id: string }
  | { type: 'RENAME_SWIMLANE';     id: string; name: string }
  | { type: 'CHANGE_SWIMLANE_COLOR'; id: string; color: string }
  | { type: 'ADD_TASK';            swimlaneId: string; name: string }
  | { type: 'SET_TASK_START';      taskId: string; startDate: string }
  | { type: 'SET_TASK_END';        taskId: string; endDate: string }
  | { type: 'DELETE_TASK';         id: string }
  | { type: 'ADD_MILESTONE';       swimlaneId: string; name: string }
  | { type: 'PLACE_MILESTONE';     milestoneId: string; date: string }
  | { type: 'DELETE_MILESTONE';    id: string }
  | { type: 'SET_VIEW_MODE';       mode: ViewMode }
  | { type: 'NAVIGATE';            deltaDays: number }
  | { type: 'SET_HOVER_DATE';      date: string | null };

// ─── Tiny ID generator (no external deps) ────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state: GanttState, action: Action): GanttState {
  switch (action.type) {

    // ── Swimlane CRUD ─────────────────────────────────────────────────────────

    case 'ADD_SWIMLANE':
      return {
        ...state,
        swimlanes: [...state.swimlanes, { id: uid(), name: action.name, color: action.color }],
      };

    case 'DELETE_SWIMLANE':
      // Cascade-delete all tasks and milestones belonging to this swimlane
      return {
        ...state,
        swimlanes:  state.swimlanes.filter(s => s.id !== action.id),
        tasks:      state.tasks.filter(t => t.swimlaneId !== action.id),
        milestones: state.milestones.filter(m => m.swimlaneId !== action.id),
      };

    case 'RENAME_SWIMLANE':
      return {
        ...state,
        swimlanes: state.swimlanes.map(s =>
          s.id === action.id ? { ...s, name: action.name } : s),
      };

    case 'CHANGE_SWIMLANE_COLOR':
      return {
        ...state,
        swimlanes: state.swimlanes.map(s =>
          s.id === action.id ? { ...s, color: action.color } : s),
      };

    // ── Task lifecycle ────────────────────────────────────────────────────────

    case 'ADD_TASK':
      return {
        ...state,
        tasks: [
          ...state.tasks,
          { id: uid(), swimlaneId: action.swimlaneId, name: action.name, status: 'pending-start' },
        ],
      };

    case 'SET_TASK_START':
      // Transition pending-start → pending-end and record the start date
      return {
        ...state,
        tasks: state.tasks.map(t =>
          t.id === action.taskId
            ? { ...t, status: 'pending-end', startDate: action.startDate }
            : t),
      };

    case 'SET_TASK_END':
      // Transition pending-end → placed, record end date, clear hover ghost
      return {
        ...state,
        hoverDate: null,
        tasks: state.tasks.map(t =>
          t.id === action.taskId
            ? { ...t, status: 'placed', endDate: action.endDate }
            : t),
      };

    case 'DELETE_TASK':
      return { ...state, tasks: state.tasks.filter(t => t.id !== action.id) };

    // ── Milestone lifecycle ───────────────────────────────────────────────────

    case 'ADD_MILESTONE':
      return {
        ...state,
        milestones: [
          ...state.milestones,
          { id: uid(), swimlaneId: action.swimlaneId, name: action.name, status: 'pending' },
        ],
      };

    case 'PLACE_MILESTONE':
      return {
        ...state,
        milestones: state.milestones.map(m =>
          m.id === action.milestoneId
            ? { ...m, status: 'placed', date: action.date }
            : m),
      };

    case 'DELETE_MILESTONE':
      return { ...state, milestones: state.milestones.filter(m => m.id !== action.id) };

    // ── View controls ─────────────────────────────────────────────────────────

    case 'SET_VIEW_MODE':
      return {
        ...state,
        viewMode: action.mode,
        // When switching to week view, snap viewStart to the nearest Monday
        // so week columns always start on Monday.
        viewStart: action.mode === 'week' ? weekStart(state.viewStart) : state.viewStart,
      };

    case 'NAVIGATE':
      return { ...state, viewStart: addDays(state.viewStart, action.deltaDays) };

    // ── Ghost bar hover tracking ──────────────────────────────────────────────

    case 'SET_HOVER_DATE':
      return { ...state, hoverDate: action.date };

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface GanttContextValue {
  state: GanttState;
  dispatch: React.Dispatch<Action>;
  /** Pre-computed flat row list — drives both sidebar and calendar rendering */
  rows: GanttRow[];
}

const GanttContext = createContext<GanttContextValue | null>(null);

// ─── Row flattening ───────────────────────────────────────────────────────────

/**
 * Flatten the normalized state (swimlanes / tasks / milestones arrays) into
 * an ordered list of GanttRow entries.
 *
 * Order:
 *   swimlane header row
 *     task row 1
 *     task row 2
 *     milestone row 1
 *     …
 *   next swimlane header row
 *   …
 *
 * This list is the single source of truth for row ordering — both the sidebar
 * and the calendar iterate over it in the same order.
 */
function computeRows(
  swimlanes: Swimlane[],
  tasks: Task[],
  milestones: Milestone[],
): GanttRow[] {
  const rows: GanttRow[] = [];
  for (const swimlane of swimlanes) {
    rows.push({ kind: 'swimlane', swimlane });
    for (const task of tasks.filter(t => t.swimlaneId === swimlane.id)) {
      rows.push({ kind: 'task', task, swimlane });
    }
    for (const milestone of milestones.filter(m => m.swimlaneId === swimlane.id)) {
      rows.push({ kind: 'milestone', milestone, swimlane });
    }
  }
  return rows;
}

// ─── Initial state ────────────────────────────────────────────────────────────

const initialViewStart = weekStart(today()); // always start on Monday

const initialState: GanttState = {
  swimlanes: [],
  tasks: [],
  milestones: [],
  viewMode: 'week',
  viewStart: initialViewStart,
  viewDays: 84, // 12 weeks
  hoverDate: null,
};

// ─── Provider component ───────────────────────────────────────────────────────

export function GanttProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const rows = computeRows(state.swimlanes, state.tasks, state.milestones);

  return (
    <GanttContext.Provider value={{ state, dispatch, rows }}>
      {children}
    </GanttContext.Provider>
  );
}

// ─── Consumer hook ────────────────────────────────────────────────────────────

/** Access Gantt state and dispatch from any child component */
export function useGantt(): GanttContextValue {
  const ctx = useContext(GanttContext);
  if (!ctx) throw new Error('useGantt must be called inside <GanttProvider>');
  return ctx;
}
