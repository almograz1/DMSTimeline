export type ViewMode = 'daily' | 'weekly';

/** A timeline is a named workspace owned by one user */
export interface Timeline {
  id: string;
  userId: string;
  name: string;
  createdAt: number; // epoch ms
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
  /** Optional override color — if set, overrides the project color for this task */
  color?: string;
}

export interface GanttMilestone {
  id: string;
  type: 'milestone';
  userId: string;
  timelineId: string;
  projectId: string;
  subgroupId?: string | null;
  name: string;
  date: string | null;
  order: number;
  description?: string;
  /** Optional override color — if set, overrides the project color for this milestone */
  color?: string;
}

export type GanttItem = GanttTask | GanttMilestone;

export type CalendarRow =
  | { kind: 'header';     project: Project }
  | { kind: 'subheader';  subgroup: Subgroup; project: Project }
  | { kind: 'item';       item: GanttTask;              project: Project; subgroup?: Subgroup }
  | { kind: 'milestones'; milestones: GanttMilestone[]; project: Project; subgroup?: Subgroup };

/** A vacation period blocks task/milestone placement across all swimlanes */
export interface VacationPeriod {
  id: string;
  userId: string;
  timelineId: string;
  name: string;
  startDate: string; // ISO 'YYYY-MM-DD'
  endDate: string;   // ISO 'YYYY-MM-DD'
}
