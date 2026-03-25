export type ViewMode = 'daily' | 'weekly';

export interface Project {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
  order: number;
}

export interface GanttTask {
  id: string;
  type: 'task';
  projectId: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  order: number;
  description?: string;
}

export interface GanttMilestone {
  id: string;
  type: 'milestone';
  projectId: string;
  name: string;
  date: string | null;
  order: number;
  description?: string;
}

export type GanttItem = GanttTask | GanttMilestone;

export type CalendarRow =
  | { kind: 'header';     project: Project }
  | { kind: 'item';       item: GanttTask;              project: Project }
  | { kind: 'milestones'; milestones: GanttMilestone[]; project: Project };
