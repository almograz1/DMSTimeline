import React, {
  createContext, useContext, useReducer,
  useCallback, useEffect, useState, useRef,
} from 'react';
import {
  collection, doc,
  setDoc, deleteDoc, onSnapshot,
  writeBatch, query, where, deleteField, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Project, Subgroup, MilestoneRow, TaskRow, GanttItem, GanttTask, GanttMilestone, ViewMode, VacationPeriod, ItemLink } from '../types';
import { formatDate, defaultCalendarWindow, addDays, parseDate } from '../utils/dateUtils';
import { useAuth } from '../auth/AuthContext';
import { useTimeline } from '../auth/TimelineContext';

const PROJECTS_COL  = 'projects';
const VACATIONS_COL      = 'vacations';
const MILESTONE_ROWS_COL = 'milestoneRows';
const TASK_ROWS_COL      = 'taskRows';
const SUBGROUPS_COL = 'subgroups';
const ITEMS_COL     = 'items';
const LINKS_COL     = 'itemLinks';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextOrder(existing: { order?: number }[]): number {
  if (existing.length === 0) return 0;
  return Math.max(...existing.map(x => x.order ?? 0)) + 1000;
}

function reindex<T extends { order: number }>(items: T[]): T[] {
  return items.map((item, i) => ({ ...item, order: i * 1000 }));
}

/** Capture the persisted-data slices of state for the undo stack */
function dataSnapshot(s: GanttState): DataSnapshot {
  return {
    projects:      s.projects,
    subgroups:     s.subgroups,
    items:         s.items,
    vacations:     s.vacations,
    milestoneRows: s.milestoneRows,
    taskRows:      s.taskRows,
    links:         s.links,
  };
}

/** Firestore rejects `undefined` field values — drop them before writing */
function stripUndefined<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

// ─── State ────────────────────────────────────────────────────────────────────

interface GanttState {
  projects: Project[];
  subgroups: Subgroup[];
  items: GanttItem[];
  vacations: VacationPeriod[];
  milestoneRows: MilestoneRow[];
  taskRows: TaskRow[];
  links: ItemLink[];
  viewMode: ViewMode;
  calendarStart: string;
  calendarDays: number;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

type Action =
  | { type: 'LOAD_PROJECTS';           projects: Project[] }
  | { type: 'LOAD_SUBGROUPS';          subgroups: Subgroup[] }
  | { type: 'LOAD_ITEMS';              items: GanttItem[] }
  | { type: 'ADD_PROJECT';             project: Project }
  | { type: 'DELETE_PROJECT';          projectId: string }
  | { type: 'TOGGLE_COLLAPSE';         projectId: string }
  | { type: 'REORDER_PROJECTS';        orderedIds: string[] }
  | { type: 'REORDER_ITEMS';           projectId: string; subgroupId?: string | null; orderedIds: string[] }
  | { type: 'REORDER_LANE';            projectId: string; subgroupId: string | null; ordered: { id: string; kind: 'item' | 'taskrow' }[] }
  | { type: 'ADD_SUBGROUP';            subgroup: Subgroup }
  | { type: 'DELETE_SUBGROUP';         subgroupId: string }
  | { type: 'TOGGLE_SUBGROUP_COLLAPSE'; subgroupId: string }
  | { type: 'ADD_ITEM';                item: GanttItem }
  | { type: 'UPDATE_ITEM';             itemId: string; patch: Partial<GanttTask> | Partial<GanttMilestone> }
  | { type: 'UPDATE_ITEMS';            updates: { itemId: string; patch: Partial<GanttTask> | Partial<GanttMilestone> }[] }
  | { type: 'DELETE_ITEM';             itemId: string }
  | { type: 'LOAD_LINKS';              links: ItemLink[] }
  | { type: 'ADD_LINK';                link: ItemLink }
  | { type: 'DELETE_LINK';             linkId: string }
  | { type: 'LOAD_VACATIONS';          vacations: VacationPeriod[] }
  | { type: 'LOAD_MILESTONE_ROWS';    milestoneRows: MilestoneRow[] }
  | { type: 'ADD_MILESTONE_ROW';      milestoneRow: MilestoneRow }
  | { type: 'UPDATE_MILESTONE_ROW';   milestoneRowId: string; patch: Partial<MilestoneRow> }
  | { type: 'DELETE_MILESTONE_ROW';   milestoneRowId: string }
  | { type: 'LOAD_TASK_ROWS';         taskRows: TaskRow[] }
  | { type: 'ADD_TASK_ROW';           taskRow: TaskRow }
  | { type: 'UPDATE_TASK_ROW';        taskRowId: string; patch: Partial<TaskRow> }
  | { type: 'DELETE_TASK_ROW';        taskRowId: string }
  | { type: 'REORDER_TASK_ROWS';      projectId: string; subgroupId?: string | null; orderedIds: string[] }
  | { type: 'UPDATE_TASK_ROW_ORDER';  taskRowId: string; order: number; projectId: string }
  | { type: 'REORDER_MILESTONE_ROWS'; projectId: string; subgroupId?: string | null; orderedIds: string[] }
  | { type: 'ADD_VACATION';            vacation: VacationPeriod }
  | { type: 'DELETE_VACATION';         vacationId: string }
  | { type: 'SET_VIEW_MODE';           viewMode: ViewMode }
  | { type: 'PAN_CALENDAR';            days: number }
  | { type: 'GO_TO_TODAY' }
  | { type: 'RESTORE_STATE';           data: DataSnapshot };

/** The subset of state that undo restores (everything except view/pan settings) */
interface DataSnapshot {
  projects: Project[];
  subgroups: Subgroup[];
  items: GanttItem[];
  vacations: VacationPeriod[];
  milestoneRows: MilestoneRow[];
  taskRows: TaskRow[];
  links: ItemLink[];
}

/** Action types that don't change persisted data and so aren't part of undo history */
const NON_HISTORY_ACTIONS = new Set<Action['type']>([
  'SET_VIEW_MODE', 'PAN_CALENDAR', 'GO_TO_TODAY', 'RESTORE_STATE',
]);

// ─── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state: GanttState, action: Action): GanttState {
  switch (action.type) {
    case 'LOAD_PROJECTS':
      return { ...state, projects: [...action.projects].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) };
    case 'LOAD_SUBGROUPS':
      return { ...state, subgroups: [...action.subgroups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) };
    case 'LOAD_ITEMS':
      return { ...state, items: [...action.items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) };

    case 'ADD_PROJECT':
      return { ...state, projects: [...state.projects, action.project] };
    case 'DELETE_PROJECT': {
      const removedIds = new Set(state.items.filter(i => i.projectId === action.projectId).map(i => i.id));
      return {
        ...state,
        projects:  state.projects.filter(p => p.id !== action.projectId),
        subgroups: state.subgroups.filter(s => s.projectId !== action.projectId),
        items:     state.items.filter(i => i.projectId !== action.projectId),
        links:     state.links.filter(l => !removedIds.has(l.sourceId) && !removedIds.has(l.targetId)),
      };
    }
    case 'TOGGLE_COLLAPSE':
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === action.projectId ? { ...p, collapsed: !p.collapsed } : p
        ),
      };
    case 'REORDER_PROJECTS': {
      const indexMap = new Map(action.orderedIds.map((id, i) => [id, i]));
      const sorted   = [...state.projects].sort((a, b) => (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0));
      return { ...state, projects: reindex(sorted) };
    }
    case 'REORDER_ITEMS': {
      const indexMap = new Map(action.orderedIds.map((id, i) => [id, i]));
      // Only reindex tasks within the specific subgroup (not all project tasks)
      const groupTasks = state.items
        .filter(i =>
          i.projectId === action.projectId &&
          i.type === 'task' &&
          (i.subgroupId ?? null) === (action.subgroupId ?? null)
        )
        .sort((a, b) => (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0));
      const reindexed  = reindex(groupTasks);
      const reindexMap = new Map(reindexed.map(t => [t.id, t]));
      return { ...state, items: state.items.map(item => reindexMap.get(item.id) ?? item) };
    }
    case 'REORDER_LANE': {
      // Unified ordering for a swim-lane's tasks + task rows (milestones stay
      // pinned above). Tasks may move into this lane's context (project/subgroup);
      // task rows only reorder within their own context.
      const sg = action.subgroupId ?? null;
      const orderMap = new Map(action.ordered.map((e, i) => [`${e.kind}:${e.id}`, i * 1000]));
      return {
        ...state,
        items: state.items.map(it => {
          const o = orderMap.get(`item:${it.id}`);
          return o === undefined ? it : { ...it, order: o, projectId: action.projectId, subgroupId: sg };
        }),
        taskRows: state.taskRows.map(r => {
          const o = orderMap.get(`taskrow:${r.id}`);
          return o === undefined ? r : { ...r, order: o };
        }),
      };
    }
    case 'ADD_SUBGROUP':
      return { ...state, subgroups: [...state.subgroups, action.subgroup] };
    case 'DELETE_SUBGROUP': {
      const topItems   = state.items.filter(i => !i.subgroupId);
      const maxOrder   = topItems.length > 0 ? Math.max(...topItems.map(i => i.order ?? 0)) : 0;
      let offset = 0;
      return {
        ...state,
        subgroups: state.subgroups.filter(s => s.id !== action.subgroupId),
        items: state.items.map(item => {
          if (item.subgroupId === action.subgroupId) {
            offset += 1000;
            return { ...item, subgroupId: null, order: maxOrder + offset };
          }
          return item;
        }),
      };
    }
    case 'TOGGLE_SUBGROUP_COLLAPSE':
      return {
        ...state,
        subgroups: state.subgroups.map(s =>
          s.id === action.subgroupId ? { ...s, collapsed: !s.collapsed } : s
        ),
      };
    case 'ADD_ITEM':
      return { ...state, items: [...state.items, action.item] };
    case 'UPDATE_ITEM':
      return {
        ...state,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items: state.items.map(item => item.id === action.itemId ? { ...item, ...(action.patch as any) } : item),
      };
    case 'UPDATE_ITEMS': {
      const patchMap = new Map(action.updates.map(u => [u.itemId, u.patch]));
      return {
        ...state,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items: state.items.map(item => patchMap.has(item.id) ? { ...item, ...(patchMap.get(item.id) as any) } : item),
      };
    }
    case 'DELETE_ITEM':
      return {
        ...state,
        items: state.items.filter(i => i.id !== action.itemId),
        // Drop any links that referenced the removed item
        links: state.links.filter(l => l.sourceId !== action.itemId && l.targetId !== action.itemId),
      };
    case 'LOAD_LINKS':
      return { ...state, links: action.links };
    case 'ADD_LINK':
      return { ...state, links: [...state.links, action.link] };
    case 'DELETE_LINK':
      return { ...state, links: state.links.filter(l => l.id !== action.linkId) };
    case 'LOAD_VACATIONS':
      return { ...state, vacations: [...action.vacations].sort((a, b) => a.startDate.localeCompare(b.startDate)) };
    case 'ADD_VACATION':
      return { ...state, vacations: [...state.vacations, action.vacation] };
    case 'DELETE_VACATION':
      return { ...state, vacations: state.vacations.filter(v => v.id !== action.vacationId) };
    case 'REORDER_MILESTONE_ROWS': {
      const indexMap = new Map(action.orderedIds.map((id, i) => [id, i]));
      const sgId = action.subgroupId ?? null;
      const sorted = [...state.milestoneRows.filter(r =>
        r.projectId === action.projectId && (r.subgroupId ?? null) === sgId
      )].sort((a, b) => (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0));
      const reindexed  = reindex(sorted);
      const reindexMap = new Map(reindexed.map(r => [r.id, r]));
      return { ...state, milestoneRows: state.milestoneRows.map(r => reindexMap.get(r.id) ?? r) };
    }
    case 'UPDATE_TASK_ROW_ORDER':
      return {
        ...state,
        taskRows: state.taskRows.map(r =>
          r.id === action.taskRowId ? { ...r, order: action.order } : r
        ).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      };
    case 'REORDER_TASK_ROWS': {
      const indexMap = new Map(action.orderedIds.map((id, i) => [id, i]));
      const sgId = action.subgroupId ?? null;
      const sorted = [...state.taskRows.filter(r =>
        r.projectId === action.projectId && (r.subgroupId ?? null) === sgId
      )].sort((a, b) => (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0));
      const reindexed = reindex(sorted);
      const reindexMap = new Map(reindexed.map(r => [r.id, r]));
      return { ...state, taskRows: state.taskRows.map(r => reindexMap.get(r.id) ?? r) };
    }
    case 'LOAD_TASK_ROWS':
      return { ...state, taskRows: [...action.taskRows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) };
    case 'UPDATE_TASK_ROW':
      return { ...state, taskRows: state.taskRows.map(r => r.id === action.taskRowId ? { ...r, ...action.patch } : r) };
    case 'ADD_TASK_ROW':
      return { ...state, taskRows: [...state.taskRows, action.taskRow] };
    case 'DELETE_TASK_ROW':
      return {
        ...state,
        taskRows: state.taskRows.filter(r => r.id !== action.taskRowId),
        items: state.items.map(item =>
          item.type === 'task' && item.taskRowId === action.taskRowId ? { ...item, taskRowId: null } : item
        ),
      };
    case 'LOAD_MILESTONE_ROWS':
      return { ...state, milestoneRows: [...action.milestoneRows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) };
    case 'UPDATE_MILESTONE_ROW':
      return { ...state, milestoneRows: state.milestoneRows.map(r => r.id === action.milestoneRowId ? { ...r, ...action.patch } : r) };
    case 'ADD_MILESTONE_ROW':
      return { ...state, milestoneRows: [...state.milestoneRows, action.milestoneRow] };
    case 'DELETE_MILESTONE_ROW':
      return {
        ...state,
        milestoneRows: state.milestoneRows.filter(r => r.id !== action.milestoneRowId),
        // Unassign milestones from the deleted row (move to default)
        items: state.items.map(item =>
          item.type === 'milestone' && item.milestoneRowId === action.milestoneRowId
            ? { ...item, milestoneRowId: null }
            : item
        ),
      };
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.viewMode };
    case 'PAN_CALENDAR': {
      const current = parseDate(state.calendarStart);
      return { ...state, calendarStart: formatDate(addDays(current, action.days)) };
    }
    case 'GO_TO_TODAY': {
      const { startDate } = defaultCalendarWindow();
      return { ...state, calendarStart: formatDate(startDate) };
    }
    case 'RESTORE_STATE':
      return { ...state, ...action.data };
    default: return state;
  }
}

function buildInitialState(): GanttState {
  const { startDate, totalDays } = defaultCalendarWindow();
  return {
    projects: [], subgroups: [], items: [], vacations: [], milestoneRows: [], taskRows: [], links: [],
    viewMode: 'weekly',
    calendarStart: formatDate(startDate),
    calendarDays: totalDays,
  };
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface GanttContextValue {
  state: GanttState;
  dispatch: React.Dispatch<Action>;
  genId: () => string;
  loading: boolean;
  /** Revert the most recent change (Ctrl+Z). Confirms first if it would delete items. */
  undo: () => void;
  canUndo: boolean;
}

const GanttContext = createContext<GanttContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function GanttProvider({ children }: { children: React.ReactNode }) {
  const { user }                          = useAuth();
  const { activeTimeline }                = useTimeline();
  const [state, dispatch]                 = useReducer(reducer, undefined, buildInitialState);
  const [loading, setLoading]             = useState(true);

  // ── Undo history ────────────────────────────────────────────────────────────
  // Stack of pre-mutation data snapshots. The reducer updates immutably, so each
  // snapshot just holds references to the old arrays — no deep clone needed.
  const undoStackRef          = useRef<DataSnapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const genId = useCallback(
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    []
  );

  // ── Firestore → local: scoped to userId + timelineId ──────────────────────
  useEffect(() => {
    // Undo history is per-timeline — never carry it across a timeline switch.
    undoStackRef.current = [];
    setCanUndo(false);

    if (!user || !activeTimeline) {
      dispatch({ type: 'LOAD_PROJECTS',  projects:  [] });
      dispatch({ type: 'LOAD_SUBGROUPS', subgroups: [] });
      dispatch({ type: 'LOAD_ITEMS',     items:     [] });
      dispatch({ type: 'LOAD_LINKS',     links:     [] });
      setLoading(false);
      return;
    }

    setLoading(true);
    let loadedCount = 0;

    function markLoaded() {
      loadedCount++;
      if (loadedCount === 3) setLoading(false);
    }

    const uid = user.uid;
    const tid = activeTimeline.id;

    const unsubProjects = onSnapshot(
      query(collection(db, PROJECTS_COL), where('timelineId', '==', tid)),
      snapshot => { dispatch({ type: 'LOAD_PROJECTS', projects: snapshot.docs.map(d => d.data() as Project) }); markLoaded(); },
      err => { console.error('projects:', err); markLoaded(); }
    );
    const unsubSubgroups = onSnapshot(
      query(collection(db, SUBGROUPS_COL), where('timelineId', '==', tid)),
      snapshot => { dispatch({ type: 'LOAD_SUBGROUPS', subgroups: snapshot.docs.map(d => d.data() as Subgroup) }); markLoaded(); },
      err => { console.error('subgroups:', err); markLoaded(); }
    );
    const unsubItems = onSnapshot(
      query(collection(db, ITEMS_COL), where('timelineId', '==', tid)),
      snapshot => { dispatch({ type: 'LOAD_ITEMS', items: snapshot.docs.map(d => d.data() as GanttItem) }); markLoaded(); },
      err => { console.error('items:', err); markLoaded(); }
    );
    const unsubVacations = onSnapshot(
      query(collection(db, VACATIONS_COL), where('timelineId', '==', tid)),
      snapshot => { dispatch({ type: 'LOAD_VACATIONS', vacations: snapshot.docs.map(d => d.data() as VacationPeriod) }); },
      err => { console.error('vacations:', err); }
    );
    const unsubTaskRows = onSnapshot(
      query(collection(db, TASK_ROWS_COL), where('timelineId', '==', tid)),
      snapshot => { dispatch({ type: 'LOAD_TASK_ROWS', taskRows: snapshot.docs.map(d => d.data() as TaskRow) }); },
      err => { console.error('taskRows:', err); }
    );
    const unsubMilestoneRows = onSnapshot(
      query(collection(db, MILESTONE_ROWS_COL), where('timelineId', '==', tid)),
      snapshot => {
        dispatch({ type: 'LOAD_MILESTONE_ROWS', milestoneRows: snapshot.docs.map(d => d.data() as MilestoneRow) });
      },
      err => { console.error('milestoneRows:', err); }
    );
    const unsubLinks = onSnapshot(
      query(collection(db, LINKS_COL), where('timelineId', '==', tid)),
      snapshot => { dispatch({ type: 'LOAD_LINKS', links: snapshot.docs.map(d => d.data() as ItemLink) }); },
      err => { console.error('links:', err); }
    );

    return () => { unsubProjects(); unsubSubgroups(); unsubItems(); unsubVacations(); unsubMilestoneRows(); unsubTaskRows(); unsubLinks(); };
  }, [user, activeTimeline]);

  // ── Local → Firestore ────────────────────────────────────────────────────────
  const lastActionRef = useRef<Action | null>(null);

  const dispatchWithSync = useCallback((incomingAction: Action) => {
    if (!user || !activeTimeline) return;

    let action = incomingAction;
    const uid  = user.uid;
    const tid  = activeTimeline.id;

    // Stamp userId + timelineId on creation, and assign order
    if (action.type === 'ADD_PROJECT') {
      action = { ...action, project: { ...action.project, userId: uid, timelineId: tid, order: nextOrder(state.projects) } };
    }
    if (action.type === 'ADD_SUBGROUP') {
      const siblings = state.subgroups.filter(s => s.projectId === (action as { subgroup: Subgroup }).subgroup.projectId);
      action = { ...action, subgroup: { ...(action as { subgroup: Subgroup }).subgroup, userId: uid, timelineId: tid, order: nextOrder(siblings) } };
    }
    if (action.type === 'ADD_ITEM') {
      const projectItems = state.items.filter(i => i.projectId === (action as { item: GanttItem }).item.projectId);
      action = { ...action, item: { ...(action as { item: GanttItem }).item, userId: uid, timelineId: tid, order: nextOrder(projectItems) } };
    }
    if (action.type === 'ADD_VACATION') {
      action = { ...action, vacation: { ...(action as { vacation: import('../types').VacationPeriod }).vacation, userId: uid, timelineId: tid } };
    }
    if (action.type === 'ADD_LINK') {
      action = { ...action, link: { ...action.link, userId: uid, timelineId: tid } };
    }
    if (action.type === 'ADD_TASK_ROW') {
      const siblings = state.taskRows.filter(r => r.projectId === (action as { taskRow: TaskRow }).taskRow.projectId);
      action = { ...action, taskRow: { ...(action as { taskRow: TaskRow }).taskRow, userId: uid, timelineId: tid, order: nextOrder(siblings) } };
    }
    if (action.type === 'ADD_MILESTONE_ROW') {
      const siblings = state.milestoneRows.filter(r => r.projectId === (action as { milestoneRow: MilestoneRow }).milestoneRow.projectId);
      action = { ...action, milestoneRow: { ...(action as { milestoneRow: MilestoneRow }).milestoneRow, userId: uid, timelineId: tid, order: nextOrder(siblings) } };
    }

    // Record a pre-mutation snapshot for undo (skip view/pan-only actions).
    if (!NON_HISTORY_ACTIONS.has(action.type)) {
      undoStackRef.current.push(dataSnapshot(state));
      if (undoStackRef.current.length > 50) undoStackRef.current.shift();
      setCanUndo(true);
    }

    lastActionRef.current = action;
    dispatch(action);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeTimeline, state]);

  useEffect(() => {
    const action = lastActionRef.current;
    if (!action) return;
    lastActionRef.current = null;
    syncToFirestore(action, state).catch(err => console.error('Firestore sync:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ── Undo (Ctrl+Z) ────────────────────────────────────────────────────────────
  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) { setCanUndo(false); return; }
    const current = dataSnapshot(state);

    // If reverting would delete tasks/milestones that exist right now, confirm first.
    const prevItemIds  = new Set(prev.items.map(i => i.id));
    const removedItems = current.items.filter(i => !prevItemIds.has(i.id));
    if (removedItems.length > 0) {
      const names = removedItems.slice(0, 6).map(i => '• ' + (i.name?.trim() || 'Untitled')).join('\n');
      const more  = removedItems.length > 6 ? `\n…and ${removedItems.length - 6} more` : '';
      const ok = window.confirm(
        `Undo will remove ${removedItems.length} item${removedItems.length === 1 ? '' : 's'}:\n\n${names}${more}\n\nContinue?`
      );
      if (!ok) { undoStackRef.current.push(prev); return; } // keep history intact
    }

    dispatch({ type: 'RESTORE_STATE', data: prev });
    setCanUndo(undoStackRef.current.length > 0);
    restoreSnapshotToFirestore(prev, current).catch(err => console.error('Undo sync:', err));
  }, [state]);

  // Keep a stable ref so the global key listener always calls the latest undo().
  const undoRef = useRef(undo);
  undoRef.current = undo;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Match on e.code (physical key) so undo also works under non-Latin keyboard
      // layouts (e.g. Hebrew), where e.key for the Z key is not 'z'/'Z'.
      const isZ = e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z';
      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && isZ;
      if (!isUndo) return;
      // Don't hijack undo while the user is editing text in a field.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      undoRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <GanttContext.Provider value={{ state, dispatch: dispatchWithSync, genId, loading, undo, canUndo }}>
      {children}
    </GanttContext.Provider>
  );
}

// ─── Firestore Sync ───────────────────────────────────────────────────────────

async function syncToFirestore(action: Action, state: GanttState): Promise<void> {
  switch (action.type) {
    case 'ADD_PROJECT':
      await setDoc(doc(db, PROJECTS_COL, action.project.id), action.project);
      break;
    case 'DELETE_PROJECT': {
      const batch = writeBatch(db);
      batch.delete(doc(db, PROJECTS_COL, action.projectId));
      for (const s of state.subgroups.filter(s => s.projectId === action.projectId))
        batch.delete(doc(db, SUBGROUPS_COL, s.id));
      for (const item of state.items.filter(i => i.projectId === action.projectId))
        batch.delete(doc(db, ITEMS_COL, item.id));
      await batch.commit();
      break;
    }
    case 'TOGGLE_COLLAPSE':
      await setDoc(doc(db, PROJECTS_COL, action.projectId),
        { collapsed: state.projects.find(p => p.id === action.projectId)?.collapsed }, { merge: true });
      break;
    case 'REORDER_PROJECTS': {
      const batch = writeBatch(db);
      for (const p of state.projects)
        batch.set(doc(db, PROJECTS_COL, p.id), { order: p.order }, { merge: true });
      await batch.commit();
      break;
    }
    case 'REORDER_ITEMS': {
      const batch = writeBatch(db);
      for (const t of state.items.filter(i =>
        i.projectId === action.projectId &&
        i.type === 'task' &&
        (i.subgroupId ?? null) === (action.subgroupId ?? null)
      ))
        batch.set(doc(db, ITEMS_COL, t.id), { order: t.order }, { merge: true });
      await batch.commit();
      break;
    }
    case 'REORDER_LANE': {
      const batch = writeBatch(db);
      action.ordered.forEach((e, i) => {
        if (e.kind === 'item')
          batch.set(doc(db, ITEMS_COL, e.id), { order: i * 1000, projectId: action.projectId, subgroupId: action.subgroupId ?? null }, { merge: true });
        else
          batch.set(doc(db, TASK_ROWS_COL, e.id), { order: i * 1000 }, { merge: true });
      });
      await batch.commit();
      break;
    }
    case 'ADD_SUBGROUP':
      await setDoc(doc(db, SUBGROUPS_COL, action.subgroup.id), action.subgroup);
      break;
    case 'DELETE_SUBGROUP': {
      await deleteDoc(doc(db, SUBGROUPS_COL, action.subgroupId));
      // Items should already be deleted via individual DELETE_ITEM dispatches,
      // but as a safety net delete any remaining subgroup items from Firestore too.
      const remaining = state.items.filter(i => i.subgroupId === action.subgroupId);
      if (remaining.length > 0) {
        const batch = writeBatch(db);
        for (const item of remaining)
          batch.delete(doc(db, ITEMS_COL, item.id));
        await batch.commit();
      }
      break;
    }
    case 'TOGGLE_SUBGROUP_COLLAPSE':
      await setDoc(doc(db, SUBGROUPS_COL, action.subgroupId),
        { collapsed: state.subgroups.find(s => s.id === action.subgroupId)?.collapsed }, { merge: true });
      break;
    case 'ADD_VACATION':
      await setDoc(doc(db, VACATIONS_COL, action.vacation.id), action.vacation);
      break;
    case 'DELETE_VACATION':
      await deleteDoc(doc(db, VACATIONS_COL, action.vacationId));
      break;
    case 'REORDER_MILESTONE_ROWS': {
      const sgId = action.subgroupId ?? null;
      const batch = writeBatch(db);
      for (const r of state.milestoneRows.filter(r =>
        r.projectId === action.projectId && (r.subgroupId ?? null) === sgId
      ))
        batch.set(doc(db, MILESTONE_ROWS_COL, r.id), { order: r.order }, { merge: true });
      await batch.commit();
      break;
    }
    case 'UPDATE_TASK_ROW_ORDER':
      await setDoc(doc(db, TASK_ROWS_COL, action.taskRowId), { order: action.order }, { merge: true });
      break;
    case 'UPDATE_MILESTONE_ROW':
    case 'REORDER_MILESTONE_ROWS':
    case 'UPDATE_TASK_ROW_ORDER':
    case 'REORDER_TASK_ROWS': {
      const sgId = action.subgroupId ?? null;
      const batch = writeBatch(db);
      for (const r of state.taskRows.filter(r =>
        r.projectId === action.projectId && (r.subgroupId ?? null) === sgId
      ))
        batch.set(doc(db, TASK_ROWS_COL, r.id), { order: r.order }, { merge: true });
      await batch.commit();
      break;
    }
    case 'UPDATE_TASK_ROW':
      await setDoc(doc(db, TASK_ROWS_COL, action.taskRowId), action.patch, { merge: true });
      break;
    case 'ADD_TASK_ROW':
      await setDoc(doc(db, TASK_ROWS_COL, action.taskRow.id), action.taskRow);
      break;
    case 'DELETE_TASK_ROW': {
      await deleteDoc(doc(db, TASK_ROWS_COL, action.taskRowId));
      const batch = writeBatch(db);
      for (const item of state.items.filter(i => i.type === 'task' && i.taskRowId === action.taskRowId))
        batch.set(doc(db, ITEMS_COL, item.id), { taskRowId: null }, { merge: true });
      if (state.items.some(i => i.type === 'task' && i.taskRowId === action.taskRowId))
        await batch.commit();
      break;
    }
    case 'UPDATE_MILESTONE_ROW':
      await setDoc(doc(db, MILESTONE_ROWS_COL, action.milestoneRowId), action.patch, { merge: true });
      break;
    case 'ADD_MILESTONE_ROW':
      await setDoc(doc(db, MILESTONE_ROWS_COL, action.milestoneRow.id), action.milestoneRow);
      break;
    case 'DELETE_MILESTONE_ROW': {
      await deleteDoc(doc(db, MILESTONE_ROWS_COL, action.milestoneRowId));
      // Update unassigned milestones in Firestore
      const batch = writeBatch(db);
      for (const item of state.items.filter(i => i.type === 'milestone' && i.milestoneRowId === action.milestoneRowId))
        batch.set(doc(db, ITEMS_COL, item.id), { milestoneRowId: null }, { merge: true });
      if (state.items.some(i => i.type === 'milestone' && i.milestoneRowId === action.milestoneRowId))
        await batch.commit();
      break;
    }
    case 'ADD_ITEM':
      await setDoc(doc(db, ITEMS_COL, action.item.id), action.item);
      break;
    case 'UPDATE_ITEM': {
      // Convert null values to deleteField() so they are actually removed from Firestore
      const firestorePatch = Object.fromEntries(
        Object.entries(action.patch).map(([k, v]) => [k, v === null ? deleteField() : v])
      );
      await setDoc(doc(db, ITEMS_COL, action.itemId), firestorePatch, { merge: true });
      break;
    }
    case 'UPDATE_ITEMS': {
      const batch = writeBatch(db);
      for (const u of action.updates) {
        const patch = Object.fromEntries(
          Object.entries(u.patch).map(([k, v]) => [k, v === null ? deleteField() : v])
        );
        batch.set(doc(db, ITEMS_COL, u.itemId), patch, { merge: true });
      }
      await batch.commit();
      break;
    }
    case 'DELETE_ITEM': {
      await deleteDoc(doc(db, ITEMS_COL, action.itemId));
      // Remove any links referencing this item (two queries — Firestore has no OR)
      const [srcSnap, tgtSnap] = await Promise.all([
        getDocs(query(collection(db, LINKS_COL), where('sourceId', '==', action.itemId))),
        getDocs(query(collection(db, LINKS_COL), where('targetId', '==', action.itemId))),
      ]);
      const linkDocs = [...srcSnap.docs, ...tgtSnap.docs];
      if (linkDocs.length) {
        const batch = writeBatch(db);
        for (const d of linkDocs) batch.delete(d.ref);
        await batch.commit();
      }
      break;
    }
    case 'ADD_LINK':
      await setDoc(doc(db, LINKS_COL, action.link.id), action.link);
      break;
    case 'DELETE_LINK':
      await deleteDoc(doc(db, LINKS_COL, action.linkId));
      break;
    default: break;
  }
}

// ─── Undo: persist a restored snapshot ────────────────────────────────────────
// Diffs the restored snapshot against the current data and writes the minimal
// set of changes: delete docs that no longer exist, (re)create/overwrite docs
// that changed. Committed in chunks to stay under Firestore's 500-op batch cap.

async function restoreSnapshotToFirestore(prev: DataSnapshot, current: DataSnapshot): Promise<void> {
  const groups: [string, { id: string }[], { id: string }[]][] = [
    [PROJECTS_COL,       prev.projects,      current.projects],
    [SUBGROUPS_COL,      prev.subgroups,     current.subgroups],
    [ITEMS_COL,          prev.items,         current.items],
    [VACATIONS_COL,      prev.vacations,     current.vacations],
    [TASK_ROWS_COL,      prev.taskRows,      current.taskRows],
    [MILESTONE_ROWS_COL, prev.milestoneRows, current.milestoneRows],
    [LINKS_COL,          prev.links,         current.links],
  ];

  type Op = { kind: 'set'; col: string; data: { id: string } } | { kind: 'delete'; col: string; id: string };
  const ops: Op[] = [];

  for (const [col, prevArr, curArr] of groups) {
    const prevMap = new Map(prevArr.map(x => [x.id, x]));
    const curMap  = new Map(curArr.map(x => [x.id, x]));
    // Docs that exist now but not in the restored snapshot → delete
    for (const x of curArr) if (!prevMap.has(x.id)) ops.push({ kind: 'delete', col, id: x.id });
    // Docs in the snapshot that are new or changed → overwrite to match exactly
    for (const x of prevArr) {
      const cur = curMap.get(x.id);
      if (!cur || JSON.stringify(cur) !== JSON.stringify(x)) ops.push({ kind: 'set', col, data: x });
    }
  }

  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + 400)) {
      if (op.kind === 'delete') batch.delete(doc(db, op.col, op.id));
      else                      batch.set(doc(db, op.col, op.data.id), stripUndefined(op.data));
    }
    await batch.commit();
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGantt(): GanttContextValue {
  const ctx = useContext(GanttContext);
  if (!ctx) throw new Error('useGantt must be used inside <GanttProvider>');
  return ctx;
}
