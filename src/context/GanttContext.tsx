import React, { createContext, useContext, useReducer, useCallback } from 'react';
import type { Project, GanttItem, GanttTask, GanttMilestone, ViewMode } from '../types';
import { formatDate, defaultCalendarWindow, addDays, parseDate } from '../utils/dateUtils';

// ─── State Shape ──────────────────────────────────────────────────────────────

interface GanttState {
  projects: Project[];
  items: GanttItem[];
  viewMode: ViewMode;
  /** ISO date string: the first date visible in the calendar */
  calendarStart: string;
  /** Total number of days the calendar spans */
  calendarDays: number;
}
// TODO: Milestones In the same row
// ─── Action Types ─────────────────────────────────────────────────────────────

type Action =
  | { type: 'ADD_PROJECT';    project: Project }
  | { type: 'DELETE_PROJECT'; projectId: string }
  | { type: 'TOGGLE_COLLAPSE'; projectId: string }
  | { type: 'ADD_ITEM';       item: GanttItem }
  | { type: 'UPDATE_ITEM';    itemId: string; patch: Partial<GanttTask> | Partial<GanttMilestone> }
  | { type: 'DELETE_ITEM';    itemId: string }
  | { type: 'SET_VIEW_MODE';  viewMode: ViewMode }
  | { type: 'PAN_CALENDAR';   days: number }  // positive = forward, negative = back
  | { type: 'GO_TO_TODAY' };

// ─── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state: GanttState, action: Action): GanttState {
  switch (action.type) {

    case 'ADD_PROJECT':
      return { ...state, projects: [...state.projects, action.project] };

    case 'DELETE_PROJECT':
      return {
        ...state,
        projects: state.projects.filter(p => p.id !== action.projectId),
        // Remove all items belonging to the deleted project
        items: state.items.filter(i => i.projectId !== action.projectId),
      };

    case 'TOGGLE_COLLAPSE':
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === action.projectId ? { ...p, collapsed: !p.collapsed } : p
        ),
      };

    case 'ADD_ITEM':
      return { ...state, items: [...state.items, action.item] };

    case 'UPDATE_ITEM':
      return {
        ...state,
        items: state.items.map(item =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          item.id === action.itemId ? { ...item, ...(action.patch as any) } : item
        ),
      };

    case 'DELETE_ITEM':
      return { ...state, items: state.items.filter(i => i.id !== action.itemId) };

    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.viewMode };

    case 'PAN_CALENDAR': {
      // Shift the calendar window by `days` days
      const current = parseDate(state.calendarStart);
      const next = addDays(current, action.days);
      return { ...state, calendarStart: formatDate(next) };
    }

    case 'GO_TO_TODAY': {
      const { startDate } = defaultCalendarWindow();
      return { ...state, calendarStart: formatDate(startDate) };
    }

    default:
      return state;
  }
}

// ─── Initial State ────────────────────────────────────────────────────────────

function buildInitialState(): GanttState {
  const { startDate, totalDays } = defaultCalendarWindow();
  return {
    projects: [],
    items: [],
    viewMode: 'weekly',
    calendarStart: formatDate(startDate),
    calendarDays: totalDays,
  };
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface GanttContextValue {
  state: GanttState;
  dispatch: React.Dispatch<Action>;
  /** Generate a unique ID (simple timestamp + random suffix) */
  genId: () => string;
}

const GanttContext = createContext<GanttContextValue | null>(null);

export function GanttProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, buildInitialState);
  const genId = useCallback(
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    []
  );

  return (
    <GanttContext.Provider value={{ state, dispatch, genId }}>
      {children}
    </GanttContext.Provider>
  );
}

/** Hook — throws if used outside <GanttProvider> */
export function useGantt(): GanttContextValue {
  const ctx = useContext(GanttContext);
  if (!ctx) throw new Error('useGantt must be used inside <GanttProvider>');
  return ctx;
}
