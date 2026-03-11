// ─── Core Domain Types ────────────────────────────────────────────────────────

/** Controls how the calendar header and columns are rendered */
export type ViewMode = 'daily' | 'weekly';

/**
 * A project acts as a swim lane.
 * All tasks and milestones belong to exactly one project.
 * The project's `color` is inherited by every item it owns.
 */
export interface Project {
  id: string;
  name: string;
  /** Hex color string, e.g. '#4A90D9' */
  color: string;
  /** When true, all item rows under this project are hidden */
  collapsed: boolean;
}

/**
 * A task spans a date range.
 * Dates are nullable to support "created but not yet placed" state —
 * the user adds the task to the left panel first, then clicks the calendar to set dates.
 */
export interface GanttTask {
  id: string;
  type: 'task';
  projectId: string;
  name: string;
  /** ISO date 'YYYY-MM-DD', null if not yet placed on the calendar */
  startDate: string | null;
  /** ISO date 'YYYY-MM-DD', null if start has been set but end hasn't */
  endDate: string | null;
}

/**
 * A milestone is a single point in time (no duration).
 * Rendered as a rotated-square (diamond) on the calendar.
 */
export interface GanttMilestone {
  id: string;
  type: 'milestone';
  projectId: string;
  name: string;
  /** ISO date 'YYYY-MM-DD', null if not yet placed */
  date: string | null;
}

/** Union of the two item types — makes it easy to store them in one array */
export type GanttItem = GanttTask | GanttMilestone;

// ─── Flattened Row Model ──────────────────────────────────────────────────────

/**
 * The Gantt chart renders a flat list of "rows" derived from projects + items.
 * Each row maps 1-to-1 with a left-panel row AND a calendar row.
 */
export type CalendarRow =
  | { kind: 'header'; project: Project }
  | { kind: 'item';   item: GanttItem; project: Project };
