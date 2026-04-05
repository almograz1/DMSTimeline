import React, {
  createContext, useContext, useReducer,
  useCallback, useEffect, useState, useRef,
} from 'react';
import {
  collection, doc,
  setDoc, deleteDoc, onSnapshot,
  writeBatch, query, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Project, Subgroup, MilestoneRow, TaskRow, GanttItem, GanttTask, GanttMilestone, ViewMode, VacationPeriod } from '../types';
import { formatDate, defaultCalendarWindow, addDays, parseDate } from '../utils/dateUtils';
import { useAuth } from '../auth/AuthContext';
import { useTimeline } from '../auth/TimelineContext';

const PROJECTS_COL  = 'projects';
const VACATIONS_COL      = 'vacations';
const MILESTONE_ROWS_COL = 'milestoneRows';
const TASK_ROWS_COL      = 'taskRows';
const SUBGROUPS_COL = 'subgroups';
const ITEMS_COL     = 'items';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextOrder(existing: { order?: number }[]): number {
  if (existing.length === 0) return 0;
  return Math.max(...existing.map(x => x.order ?? 0)) + 1000;
}

function reindex<T extends { order: number }>(items: T[]): T[] {
  return items.map((item, i) => ({ ...item, order: i * 1000 }));
}

// ─── State ────────────────────────────────────────────────────────────────────

interface GanttState {
  projects: Project[];
  subgroups: Subgroup[];
  items: GanttItem[];
  vacations: VacationPeriod[];
  milestoneRows: MilestoneRow[];
  taskRows: TaskRow[];
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
  | { type: 'ADD_SUBGROUP';            subgroup: Subgroup }
  | { type: 'DELETE_SUBGROUP';         subgroupId: string }
  | { type: 'TOGGLE_SUBGROUP_COLLAPSE'; subgroupId: string }
  | { type: 'ADD_ITEM';                item: GanttItem }
  | { type: 'UPDATE_ITEM';             itemId: string; patch: Partial<GanttTask> | Partial<GanttMilestone> }
  | { type: 'DELETE_ITEM';             itemId: string }
  | { type: 'LOAD_VACATIONS';          vacations: VacationPeriod[] }
  | { type: 'LOAD_MILESTONE_ROWS';    milestoneRows: MilestoneRow[] }
  | { type: 'ADD_MILESTONE_ROW';      milestoneRow: MilestoneRow }
  | { type: 'DELETE_MILESTONE_ROW';   milestoneRowId: string }
  | { type: 'LOAD_TASK_ROWS';         taskRows: TaskRow[] }
  | { type: 'ADD_TASK_ROW';           taskRow: TaskRow }
  | { type: 'DELETE_TASK_ROW';        taskRowId: string }
  | { type: 'ADD_VACATION';            vacation: VacationPeriod }
  | { type: 'DELETE_VACATION';         vacationId: string }
  | { type: 'SET_VIEW_MODE';           viewMode: ViewMode }
  | { type: 'PAN_CALENDAR';            days: number }
  | { type: 'GO_TO_TODAY' };

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
    case 'DELETE_PROJECT':
      return {
        ...state,
        projects:  state.projects.filter(p => p.id !== action.projectId),
        subgroups: state.subgroups.filter(s => s.projectId !== action.projectId),
        items:     state.items.filter(i => i.projectId !== action.projectId),
      };
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
    case 'DELETE_ITEM':
      return { ...state, items: state.items.filter(i => i.id !== action.itemId) };
    case 'LOAD_VACATIONS':
      return { ...state, vacations: [...action.vacations].sort((a, b) => a.startDate.localeCompare(b.startDate)) };
    case 'ADD_VACATION':
      return { ...state, vacations: [...state.vacations, action.vacation] };
    case 'DELETE_VACATION':
      return { ...state, vacations: state.vacations.filter(v => v.id !== action.vacationId) };
    case 'LOAD_TASK_ROWS':
      return { ...state, taskRows: [...action.taskRows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) };
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
    default: return state;
  }
}

function buildInitialState(): GanttState {
  const { startDate, totalDays } = defaultCalendarWindow();
  return {
    projects: [], subgroups: [], items: [], vacations: [], milestoneRows: [], taskRows: [],
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
}

const GanttContext = createContext<GanttContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function GanttProvider({ children }: { children: React.ReactNode }) {
  const { user }                          = useAuth();
  const { activeTimeline }                = useTimeline();
  const [state, dispatch]                 = useReducer(reducer, undefined, buildInitialState);
  const [loading, setLoading]             = useState(true);

  const genId = useCallback(
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    []
  );

  // ── Firestore → local: scoped to userId + timelineId ──────────────────────
  useEffect(() => {
    if (!user || !activeTimeline) {
      dispatch({ type: 'LOAD_PROJECTS',  projects:  [] });
      dispatch({ type: 'LOAD_SUBGROUPS', subgroups: [] });
      dispatch({ type: 'LOAD_ITEMS',     items:     [] });
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

    return () => { unsubProjects(); unsubSubgroups(); unsubItems(); unsubVacations(); unsubMilestoneRows(); unsubTaskRows(); };
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
    if (action.type === 'ADD_TASK_ROW') {
      const siblings = state.taskRows.filter(r => r.projectId === (action as { taskRow: TaskRow }).taskRow.projectId);
      action = { ...action, taskRow: { ...(action as { taskRow: TaskRow }).taskRow, userId: uid, timelineId: tid, order: nextOrder(siblings) } };
    }
    if (action.type === 'ADD_MILESTONE_ROW') {
      const siblings = state.milestoneRows.filter(r => r.projectId === (action as { milestoneRow: MilestoneRow }).milestoneRow.projectId);
      action = { ...action, milestoneRow: { ...(action as { milestoneRow: MilestoneRow }).milestoneRow, userId: uid, timelineId: tid, order: nextOrder(siblings) } };
    }

    lastActionRef.current = action;
    dispatch(action);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeTimeline, state.projects, state.subgroups, state.items]);

  useEffect(() => {
    const action = lastActionRef.current;
    if (!action) return;
    lastActionRef.current = null;
    syncToFirestore(action, state).catch(err => console.error('Firestore sync:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <GanttContext.Provider value={{ state, dispatch: dispatchWithSync, genId, loading }}>
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
    case 'ADD_SUBGROUP':
      await setDoc(doc(db, SUBGROUPS_COL, action.subgroup.id), action.subgroup);
      break;
    case 'DELETE_SUBGROUP': {
      await deleteDoc(doc(db, SUBGROUPS_COL, action.subgroupId));
      const batch = writeBatch(db);
      for (const item of state.items.filter(i => i.subgroupId === action.subgroupId))
        batch.set(doc(db, ITEMS_COL, item.id), { subgroupId: null }, { merge: true });
      await batch.commit();
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
    case 'UPDATE_ITEM':
      await setDoc(doc(db, ITEMS_COL, action.itemId), action.patch, { merge: true });
      break;
    case 'DELETE_ITEM':
      await deleteDoc(doc(db, ITEMS_COL, action.itemId));
      break;
    default: break;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGantt(): GanttContextValue {
  const ctx = useContext(GanttContext);
  if (!ctx) throw new Error('useGantt must be used inside <GanttProvider>');
  return ctx;
}
