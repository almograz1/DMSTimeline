import React, {
  createContext, useContext, useReducer,
  useCallback, useEffect, useState,
} from 'react';
import {
  collection, doc,
  setDoc, deleteDoc, onSnapshot,
  writeBatch, query,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Project, GanttItem, GanttTask, GanttMilestone, ViewMode } from '../types';
import { formatDate, defaultCalendarWindow, addDays, parseDate } from '../utils/dateUtils';

// ─── Firestore Collection Names ───────────────────────────────────────────────
// Centralised here so a rename never requires hunting across multiple files.

const PROJECTS_COL = 'projects';
const ITEMS_COL    = 'items';

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

// ─── Action Types ─────────────────────────────────────────────────────────────
// Two new internal actions: LOAD_PROJECTS and LOAD_ITEMS.
// These are dispatched by the Firestore onSnapshot listeners when the database
// sends its initial snapshot (or any subsequent real-time update).
// No component ever dispatches these directly.

type Action =
  | { type: 'LOAD_PROJECTS';  projects: Project[] }        // internal — fired by Firestore listener
  | { type: 'LOAD_ITEMS';     items: GanttItem[] }          // internal — fired by Firestore listener
  | { type: 'ADD_PROJECT';    project: Project }
  | { type: 'DELETE_PROJECT'; projectId: string }
  | { type: 'TOGGLE_COLLAPSE'; projectId: string }
  | { type: 'ADD_ITEM';       item: GanttItem }
  | { type: 'UPDATE_ITEM';    itemId: string; patch: Partial<GanttTask> | Partial<GanttMilestone> }
  | { type: 'DELETE_ITEM';    itemId: string }
  | { type: 'SET_VIEW_MODE';  viewMode: ViewMode }
  | { type: 'PAN_CALENDAR';   days: number }
  | { type: 'GO_TO_TODAY' };

// ─── Reducer ──────────────────────────────────────────────────────────────────
// The reducer is UNCHANGED from the original — it only manages local state.
// Firestore writes happen in GanttProvider via useEffect, not inside the reducer.
// Keeping side effects out of the reducer is a core React pattern.

function reducer(state: GanttState, action: Action): GanttState {
  switch (action.type) {

    // ── Firestore → local state (hydration) ──────────────────────────────────
    case 'LOAD_PROJECTS':
      return { ...state, projects: action.projects };

    case 'LOAD_ITEMS':
      return { ...state, items: action.items };

    // ── User actions (local state only — Firestore writes handled separately) ─
    case 'ADD_PROJECT':
      return { ...state, projects: [...state.projects, action.project] };

    case 'DELETE_PROJECT':
      return {
        ...state,
        projects: state.projects.filter(p => p.id !== action.projectId),
        items:    state.items.filter(i => i.projectId !== action.projectId),
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
      const current = parseDate(state.calendarStart);
      const next    = addDays(current, action.days);
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
// projects and items start empty — Firestore listeners will populate them.

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
  genId: () => string;
  /** True while the initial Firestore snapshots haven't arrived yet */
  loading: boolean;
}

const GanttContext = createContext<GanttContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function GanttProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, buildInitialState);
  const [loading, setLoading] = useState(true);

  const genId = useCallback(
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    []
  );

  // ── Firestore → local: real-time listeners ──────────────────────────────────
  /**
   * We attach two onSnapshot listeners on mount, one per collection.
   * onSnapshot fires immediately with the current data, then again on any change.
   *
   * We track when BOTH have fired at least once using a simple counter so we
   * can clear the `loading` state accurately.
   *
   * Both listeners are unsubscribed on unmount (the functions returned by
   * onSnapshot are cleanup callbacks — we return them from useEffect).
   */
  useEffect(() => {
    let loadedCount = 0;

    // Called after each collection's first snapshot arrives
    function markLoaded() {
      loadedCount++;
      if (loadedCount === 2) setLoading(false); // both collections ready
    }

    // ── Projects listener ─────────────────────────────────────────────────────
    const unsubProjects = onSnapshot(
      query(collection(db, PROJECTS_COL)),
      (snapshot) => {
        // snapshot.docs is an array of DocumentSnapshot objects.
        // .data() returns the raw JS object stored in Firestore.
        // We cast it to Project because we control what shape we write.
        const projects = snapshot.docs.map(d => d.data() as Project);
        dispatch({ type: 'LOAD_PROJECTS', projects });
        markLoaded();
      },
      (error) => {
        console.error('Firestore projects listener error:', error);
        markLoaded(); // don't block loading forever on error
      }
    );

    // ── Items listener ────────────────────────────────────────────────────────
    const unsubItems = onSnapshot(
      query(collection(db, ITEMS_COL)),
      (snapshot) => {
        const items = snapshot.docs.map(d => d.data() as GanttItem);
        dispatch({ type: 'LOAD_ITEMS', items });
        markLoaded();
      },
      (error) => {
        console.error('Firestore items listener error:', error);
        markLoaded();
      }
    );

    // Cleanup: detach both listeners when the provider unmounts
    return () => {
      unsubProjects();
      unsubItems();
    };
  }, []); // empty deps — attach once on mount, never re-attach

  // ── Local → Firestore: write on every action ──────────────────────────────
  /**
   * This useEffect watches for dispatched actions and mirrors them to Firestore.
   *
   * IMPORTANT: We do NOT write on LOAD_PROJECTS / LOAD_ITEMS actions.
   * Those are Firestore → local hydration actions. Writing back would cause
   * an infinite loop: Firestore → local → Firestore → local → ...
   *
   * The pattern here is "action-driven sync":
   *   - Each action type knows exactly which Firestore operation it needs.
   *   - We use a ref to track the last action dispatched and react to it.
   *
   * Alternative pattern (not used here): watch `state` and write the whole
   * state on every change. Simpler but overwrites unchanged documents every time.
   */
  const lastActionRef = React.useRef<Action | null>(null);

  // Wrap dispatch to intercept every action before it hits the reducer
  const dispatchWithSync = useCallback((action: Action) => {
    lastActionRef.current = action;
    dispatch(action);
  }, []);

  useEffect(() => {
    const action = lastActionRef.current;
    if (!action) return;

    // Clear IMMEDIATELY before the async call.
    // Without this, any state change triggered by Firestore (e.g. LOAD_ITEMS after
    // a console deletion) re-runs this effect with the stale action still in the ref,
    // causing deleted documents to be re-written back to Firestore.
    lastActionRef.current = null;

    syncToFirestore(action, state).catch(err =>
      console.error('Firestore sync error:', err)
    );
  // We intentionally depend on `state` so we have the post-reducer state
  // available when computing what to write (e.g. the updated item after UPDATE_ITEM).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <GanttContext.Provider value={{ state, dispatch: dispatchWithSync, genId, loading }}>
      {children}
    </GanttContext.Provider>
  );
}

// ─── Firestore Write Logic ────────────────────────────────────────────────────
/**
 * syncToFirestore maps each action type to the correct Firestore operation.
 *
 * Rules:
 *  - LOAD_* actions → no-op (these come FROM Firestore, not going TO it)
 *  - ADD_* → setDoc (creates or overwrites a document with the item's id as key)
 *  - DELETE_* → deleteDoc (removes the document)
 *  - UPDATE_ITEM → setDoc with merge:true (only updates provided fields)
 *  - TOGGLE_COLLAPSE → setDoc with merge:true (updates just the `collapsed` field)
 *  - DELETE_PROJECT → writeBatch (atomically deletes project + all its items)
 *  - UI actions (PAN_CALENDAR, SET_VIEW_MODE, GO_TO_TODAY) → no-op (not persisted)
 */
async function syncToFirestore(action: Action, state: GanttState): Promise<void> {
  switch (action.type) {

    case 'ADD_PROJECT':
      // setDoc with the project's id as the document ID.
      // This is idempotent: calling it again with the same id overwrites the doc.
      await setDoc(doc(db, PROJECTS_COL, action.project.id), action.project);
      break;

    case 'DELETE_PROJECT': {
      /**
       * Delete the project document AND all item documents that belong to it
       * in a single atomic batch write. Either all deletes succeed or none do.
       * This prevents orphaned items if the network drops mid-operation.
       */
      const batch = writeBatch(db);
      batch.delete(doc(db, PROJECTS_COL, action.projectId));

      // Find all items belonging to this project from current state
      const orphanedItems = state.items.filter(i => i.projectId === action.projectId);
      for (const item of orphanedItems) {
        batch.delete(doc(db, ITEMS_COL, item.id));
      }

      await batch.commit();
      break;
    }

    case 'TOGGLE_COLLAPSE':
      // Only update the `collapsed` field — merge: true means other fields are untouched
      await setDoc(
        doc(db, PROJECTS_COL, action.projectId),
        { collapsed: state.projects.find(p => p.id === action.projectId)?.collapsed },
        { merge: true }
      );
      break;

    case 'ADD_ITEM':
      await setDoc(doc(db, ITEMS_COL, action.item.id), action.item);
      break;

    case 'UPDATE_ITEM':
      /**
       * merge: true is important here — we only want to update the fields in `patch`
       * (e.g. just `endDate`), not overwrite the entire document.
       * Without merge, setDoc would erase all fields not included in the write.
       */
      await setDoc(doc(db, ITEMS_COL, action.itemId), action.patch, { merge: true });
      break;

    case 'DELETE_ITEM':
      await deleteDoc(doc(db, ITEMS_COL, action.itemId));
      break;

    // These actions are UI-only — nothing to persist
    case 'LOAD_PROJECTS':
    case 'LOAD_ITEMS':
    case 'SET_VIEW_MODE':
    case 'PAN_CALENDAR':
    case 'GO_TO_TODAY':
      break;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGantt(): GanttContextValue {
  const ctx = useContext(GanttContext);
  if (!ctx) throw new Error('useGantt must be used inside <GanttProvider>');
  return ctx;
}
