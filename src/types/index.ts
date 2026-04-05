export type ViewMode = 'daily' | 'weekly';

/** Timeline is a named workspace owned by one user */
export interface Timeline {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
}

export interface Project {
  id: string;
  userId: string;
  timelineId: string;
  name: string;
  color: string;
  collapsed: boolean;
  order: number;
}

export interface Subgroup {
  id: string;
  userId: string;
  timelineId: string;
  projectId: string;
  name: string;
  collapsed: boolean;
  order: number;
}

/**
 * A milestone row config defines a named row type inside a project.
 * Each project can have multiple milestone rows (e.g. "WIP", "Release", "Review").
 * Every GanttMilestone references a milestoneRowId to know which row it belongs to.
 */
export interface MilestoneRow {
  id: string;
  userId: string;
  timelineId: string;
  projectId: string;
  name: string;       // e.g. "WIP", "Release", "Gate"
  icon: string;       // emoji icon, e.g. "◆", "🚩", "⭐", "●", "⚡", "🔷"
  order: number;
}

export interface GanttTask {
  id: string;
  type: 'task';
  userId: string;
  timelineId: string;
  projectId: string;
  subgroupId?: string | null;
  name: string;
  startDate: string | null;
  endDate: string | null;
  order: number;
  description?: string;
  color?: string;
  /** If set, this task belongs to a named task row (shared calendar line) */
  taskRowId?: string | null;
}

export interface GanttMilestone {
  id: string;
  type: 'milestone';
  userId: string;
  timelineId: string;
  projectId: string;
  subgroupId?: string | null;
  /** Which milestone row this milestone belongs to (null = legacy/default row) */
  milestoneRowId?: string | null;
  name: string;
  date: string | null;
  order: number;
  description?: string;
  color?: string;
}

export type GanttItem = GanttTask | GanttMilestone;

export type CalendarRow =
  | { kind: 'header';     project: Project }
  | { kind: 'subheader';  subgroup: Subgroup; project: Project }
  | { kind: 'item';       item: GanttTask;              project: Project; subgroup?: Subgroup }
  | { kind: 'taskrow';    tasks: GanttTask[];            project: Project; subgroup?: Subgroup; taskRow: TaskRow }
  | { kind: 'milestones'; milestones: GanttMilestone[]; project: Project; subgroup?: Subgroup; milestoneRow?: MilestoneRow };

/** A vacation period blocks task/milestone placement across all swimlanes */
export interface VacationPeriod {
  id: string;
  userId: string;
  timelineId: string;
  name: string;
  startDate: string;
  endDate: string;
}

/**
 * A task row config defines a named row inside a project/subgroup.
 * Multiple tasks can share the same row and are rendered stacked/side-by-side.
 * Tasks with no taskRowId get their own independent row (default behaviour).
 */
export interface TaskRow {
  id: string;
  userId: string;
  timelineId: string;
  projectId: string;
  subgroupId?: string | null;
  name: string;
  order: number;
}
