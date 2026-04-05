import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { useGantt } from '../context/GanttContext';
import type { CalendarRow, GanttTask, GanttMilestone, Project, Subgroup, MilestoneRow, TaskRow } from '../types';
import {
  parseDate, formatDate, addDays, dayDiff,
  buildDailyColumns, buildWeeklyColumns,
  getISOWeekNumber, getDayName, getMonthName,
  isWeekend,
} from '../utils/dateUtils';

// ─── Layout Constants ─────────────────────────────────────────────────────────

const LEFT_W           = 280;
const ROW_H            = 40;
const MILESTONE_ROW_H  = 56;
const HEADER_H         = 60;
const DAILY_COL_W      = 44;
const WEEKLY_COL_W     = 120;
const TASK_BAR_H       = 22;
const MILESTONE_SZ     = 14;
const MILESTONE_NAME_H = 16;
const LABEL_W          = 90;
const HANDLE_W         = 6;

function pxPerDay(viewMode: 'daily' | 'weekly'): number {
  return viewMode === 'daily' ? DAILY_COL_W : WEEKLY_COL_W / 7;
}

// ─── Calendar Drag Types ──────────────────────────────────────────────────────

interface CalDragState {
  kind: 'move-task' | 'resize-left' | 'resize-right' | 'move-milestone';
  itemId: string;
  startMouseX: number;
  originalStartDate: string;
  originalEndDate: string;
  originalDate: string;
  ppd: number;
  calStartDate: Date;
}

interface CalDragPreview {
  itemId: string;
  startDate: string | null;
  endDate: string | null;
  date: string | null;
}

// ─── Row Drag (reorder) types ─────────────────────────────────────────────────

/** What is being dragged in the left panel */
interface RowDragState {
  kind: 'project' | 'task';
  id: string;
  projectId?: string;   // for tasks
  subgroupId?: string | null; // current subgroup of the dragged item (null = top-level)
}

// ─── Sub-component: Task Bar ──────────────────────────────────────────────────

interface TaskBarProps {
  task: GanttTask;
  color: string;
  calStart: Date;
  ppd: number;
  rowH: number;
  preview?: { startDate: string | null; endDate: string | null };
  onDragStart: (e: React.MouseEvent, kind: 'move-task' | 'resize-left' | 'resize-right') => void;
  onBarClick?: (e: React.MouseEvent) => void;
}

function TaskBar({ task, color, calStart, ppd, rowH, preview, onDragStart, onBarClick }: TaskBarProps) {
  const startDate = preview?.startDate ?? task.startDate;
  const endDate   = preview?.endDate   ?? task.endDate;

  if (!startDate) return null;

  const start  = parseDate(startDate);
  const leftPx = dayDiff(calStart, start) * ppd;

  if (!endDate) {
    return (
      <div style={{
        position: 'absolute', left: leftPx, top: (rowH - TASK_BAR_H) / 2,
        width: TASK_BAR_H, height: TASK_BAR_H, borderRadius: 5,
        background: color + '60', border: `2px dashed ${color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }} title={`Start: ${startDate} — click row to set end date`}>
        <span style={{ color, fontSize: 14, fontWeight: 700 }}>→</span>
      </div>
    );
  }

  const end     = parseDate(endDate);
  const widthPx = Math.max((dayDiff(start, end) + 1) * ppd, HANDLE_W * 2 + 4);

  return (
    <div
      style={{
        position: 'absolute', left: leftPx, width: widthPx,
        top: (rowH - TASK_BAR_H) / 2, height: TASK_BAR_H,
        background: color, borderRadius: 5,
        display: 'flex', alignItems: 'center', overflow: 'hidden',
        boxShadow: `0 1px 4px ${color}55`, cursor: 'grab', userSelect: 'none',
      }}
      title={`${task.name}: ${startDate} → ${endDate}`}
      onMouseDown={e => { e.stopPropagation(); onDragStart(e, 'move-task'); }}
      onClick={e => { e.stopPropagation(); onBarClick?.(e); }}
    >
      <div
        style={{ position: 'absolute', left: 0, top: 0, width: HANDLE_W, height: '100%', cursor: 'ew-resize', background: 'rgba(0,0,0,0.15)', borderRadius: '5px 0 0 5px', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseDown={e => { e.stopPropagation(); onDragStart(e, 'resize-left'); }}
      >
        <div style={{ width: 1.5, height: 10, background: 'rgba(255,255,255,0.5)', borderRadius: 1 }} />
      </div>
      <span style={{ flex: 1, paddingLeft: HANDLE_W + 4, paddingRight: HANDLE_W + 4, color: '#fff', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 1px 2px rgba(0,0,0,0.3)', pointerEvents: 'none', textAlign: 'center' }}>
        {task.name}
      </span>
      <div
        style={{ position: 'absolute', right: 0, top: 0, width: HANDLE_W, height: '100%', cursor: 'ew-resize', background: 'rgba(0,0,0,0.15)', borderRadius: '0 5px 5px 0', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseDown={e => { e.stopPropagation(); onDragStart(e, 'resize-right'); }}
      >
        <div style={{ width: 1.5, height: 10, background: 'rgba(255,255,255,0.5)', borderRadius: 1 }} />
      </div>
    </div>
  );
}

// ─── Sub-component: Milestone With Label ──────────────────────────────────────

function MilestoneWithLabel({ milestone, color, calStart, ppd, previewDate, onDragStart, onLabelClick, icon }: {
  milestone: GanttMilestone; color: string; calStart: Date; ppd: number;
  previewDate?: string | null; onDragStart: (e: React.MouseEvent) => void;
  onLabelClick?: (e: React.MouseEvent) => void;
  icon?: string; // custom icon from milestone row; defaults to diamond shape
}) {
  const date = previewDate !== undefined ? previewDate : milestone.date;
  if (!date) return null;
  const centerX = dayDiff(calStart, parseDate(date)) * ppd + ppd / 2;
  // If icon is a non-diamond emoji/char, render it as text; otherwise render the rotated diamond div
  const isEmoji = icon && icon !== '◆';
  return (
    <div
      title={`${milestone.name}: ${date}`}
      style={{ position: 'absolute', left: centerX - LABEL_W / 2, top: 0, width: LABEL_W, height: MILESTONE_ROW_H, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4, cursor: 'grab', userSelect: 'none' }}
      onMouseDown={e => { e.stopPropagation(); onDragStart(e); }}
      onClick={e => { e.stopPropagation(); onLabelClick?.(e); }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: LABEL_W, lineHeight: `${MILESTONE_NAME_H}px`, textAlign: 'center', textShadow: '0 0 4px #fff, 0 0 4px #fff', pointerEvents: 'none' }}>
        {milestone.name}
      </span>
      <div style={{ width: 1, height: 4, background: color + '80', flexShrink: 0, pointerEvents: 'none' }} />
      {isEmoji ? (
        <span style={{ fontSize: MILESTONE_SZ + 2, lineHeight: 1, pointerEvents: 'none', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.2))' }}>{icon}</span>
      ) : (
        <div style={{ width: MILESTONE_SZ, height: MILESTONE_SZ, background: color, transform: 'rotate(45deg)', borderRadius: 3, boxShadow: `0 2px 6px ${color}66`, flexShrink: 0, pointerEvents: 'none' }} />
      )}
    </div>
  );
}

// ─── Calendar Header ──────────────────────────────────────────────────────────

function CalendarHeader({ columns, viewMode, colWidth, todayDate }: {
  columns: Date[]; viewMode: 'daily' | 'weekly'; colWidth: number; todayDate: string;
}) {
  const monthSpans: { label: string; count: number }[] = [];
  columns.forEach(col => {
    const label = `${getMonthName(col)} ${col.getFullYear()}`;
    if (monthSpans.length && monthSpans[monthSpans.length - 1].label === label) monthSpans[monthSpans.length - 1].count++;
    else monthSpans.push({ label, count: 1 });
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: HEADER_H, borderBottom: '1.5px solid var(--border-strong)', background: 'var(--bg-header)', position: 'sticky', top: 0, zIndex: 5 }}>
      <div style={{ display: 'flex', height: 24, borderBottom: '1px solid var(--border)' }}>
        {monthSpans.map(({ label, count }) => (
          <div key={label + count} style={{ width: count * colWidth, flexShrink: 0, display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase', borderRight: '1px solid var(--border)', overflow: 'hidden' }}>{label}</div>
        ))}
      </div>
      <div style={{ display: 'flex', flex: 1 }}>
        {columns.map((col, i) => {
          const isToday = formatDate(col) === todayDate;
          const weekend = isWeekend(col);
          return (
            <div key={i} style={{ width: colWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--border)', fontSize: 11, fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--accent)' : weekend ? 'var(--text-muted)' : 'var(--text-primary)', background: isToday ? 'var(--accent-light)' : 'transparent', overflow: 'hidden' }}>
              {viewMode === 'daily'
                ? <><span style={{ fontSize: 9, opacity: 0.7 }}>{getDayName(col)}</span><span>{col.getDate()}</span></>
                : <><span style={{ fontSize: 9, opacity: 0.7 }}>W{getISOWeekNumber(col)}</span><span>{col.getDate()} {getMonthName(col)}</span></>
              }
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Grip Handle (reorder affordance) ─────────────────────────────────────────

function GripHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      title="Drag to reorder"
      style={{
        width: 18, height: 18, cursor: 'grab', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 3, color: 'var(--text-muted)', fontSize: 11,
        opacity: 0.5,
      }}
      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
      onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
    >
      ⠿
    </div>
  );
}

// ─── Drop Indicator ───────────────────────────────────────────────────────────

function DropIndicator({ color = 'var(--accent)' }: { color?: string }) {
  return (
    <div style={{
      height: 2, background: color, borderRadius: 1,
      margin: '0 8px', pointerEvents: 'none', zIndex: 20, position: 'relative',
    }} />
  );
}

// ─── Main GanttChart ──────────────────────────────────────────────────────────

export default function GanttChart() {
  const { state, dispatch } = useGantt();
  const { projects, subgroups, items, vacations, milestoneRows, taskRows, viewMode, calendarStart, calendarDays } = state;

  // ── Zoom — must be declared before ppd/colWidth which depend on zoomScale ──
  const ZOOM_LEVELS  = [0.8, 1.0, 1.2] as const;
  const ZOOM_LABELS  = ['80%', '100%', '120%'] as const;
  const [zoomIdx, setZoomIdx] = useState(1); // default = 100%
  const zoomScale = ZOOM_LEVELS[zoomIdx];

  const today        = formatDate(new Date());
  const calStartDate = parseDate(calendarStart);
  const ppd          = pxPerDay(viewMode) * zoomScale;
  const colWidth     = (viewMode === 'daily' ? DAILY_COL_W : WEEKLY_COL_W) * zoomScale;
  const numCols      = viewMode === 'daily' ? calendarDays : Math.ceil(calendarDays / 7);

  // ── Calendar drag (move/resize bars) ─────────────────────────────────────────

  const calDragStateRef   = useRef<CalDragState | null>(null);
  const calDragPreviewRef = useRef<CalDragPreview | null>(null);
  const [calDragTick, setCalDragTick] = useState(0);

  const handleCalMouseMove = useCallback((e: MouseEvent) => {
    const drag = calDragStateRef.current;
    if (!drag) return;
    const deltaDays = Math.round((e.clientX - drag.startMouseX) / drag.ppd);
    let preview: CalDragPreview;
    switch (drag.kind) {
      case 'move-task': {
        const newStart = formatDate(addDays(parseDate(drag.originalStartDate), deltaDays));
        const dur      = dayDiff(parseDate(drag.originalStartDate), parseDate(drag.originalEndDate));
        preview = { itemId: drag.itemId, startDate: newStart, endDate: formatDate(addDays(parseDate(newStart), dur)), date: null };
        break;
      }
      case 'resize-left': {
        const ns = formatDate(addDays(parseDate(drag.originalStartDate), deltaDays));
        preview  = ns <= drag.originalEndDate
          ? { itemId: drag.itemId, startDate: ns, endDate: drag.originalEndDate, date: null }
          : calDragPreviewRef.current ?? { itemId: drag.itemId, startDate: drag.originalStartDate, endDate: drag.originalEndDate, date: null };
        break;
      }
      case 'resize-right': {
        const ne = formatDate(addDays(parseDate(drag.originalEndDate), deltaDays));
        preview  = ne >= drag.originalStartDate
          ? { itemId: drag.itemId, startDate: drag.originalStartDate, endDate: ne, date: null }
          : calDragPreviewRef.current ?? { itemId: drag.itemId, startDate: drag.originalStartDate, endDate: drag.originalEndDate, date: null };
        break;
      }
      case 'move-milestone':
        preview = { itemId: drag.itemId, startDate: null, endDate: null, date: formatDate(addDays(parseDate(drag.originalDate), deltaDays)) };
        break;
      default: return;
    }
    calDragPreviewRef.current = preview;
    setCalDragTick(t => t + 1);
  }, []);

  const handleCalMouseUp = useCallback(() => {
    const drag    = calDragStateRef.current;
    const preview = calDragPreviewRef.current;
    if (drag && preview && preview.itemId === drag.itemId) {
      if (drag.kind === 'move-milestone') {
        dispatch({ type: 'UPDATE_ITEM', itemId: drag.itemId, patch: { date: preview.date } });
      } else {
        dispatch({ type: 'UPDATE_ITEM', itemId: drag.itemId, patch: { startDate: preview.startDate, endDate: preview.endDate } });
      }
    }
    calDragStateRef.current   = null;
    calDragPreviewRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor     = '';
    document.removeEventListener('mousemove', handleCalMouseMove);
    document.removeEventListener('mouseup',   handleCalMouseUp);
  }, [dispatch, handleCalMouseMove]);

  const startCalDrag = useCallback((e: React.MouseEvent, kind: CalDragState['kind'], item: GanttTask | GanttMilestone) => {
    e.preventDefault(); e.stopPropagation();
    const t = item as GanttTask;
    const m = item as GanttMilestone;
    calDragStateRef.current = { kind, itemId: item.id, startMouseX: e.clientX, originalStartDate: t.startDate ?? '', originalEndDate: t.endDate ?? '', originalDate: m.date ?? '', ppd, calStartDate };
    calDragPreviewRef.current = null;
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = kind === 'move-task' || kind === 'move-milestone' ? 'grabbing' : 'ew-resize';
    document.addEventListener('mousemove', handleCalMouseMove);
    document.addEventListener('mouseup',   handleCalMouseUp);
  }, [ppd, calStartDate, handleCalMouseMove, handleCalMouseUp]);

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleCalMouseMove);
      document.removeEventListener('mouseup',   handleCalMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor     = '';
    };
  }, [handleCalMouseMove, handleCalMouseUp]);

  // ── Row drag (reorder in left panel) ─────────────────────────────────────────
  /**
   * Uses mouse events (not HTML5 DnD) so we have full control over the drop
   * indicator position and can prevent the default ghost image.
   *
   * rowDragState: what is being dragged
   * rowDropTarget: the row key we are currently hovering over (drop destination)
   * rowDropPosition: 'before' | 'after' — which side of the target to insert at
   */
  const ganttScrollRef = useRef<HTMLDivElement>(null);
  const rowDragStateRef                                     = useRef<RowDragState | null>(null);
  const [rowDropTarget,   setRowDropTarget]   = useState<string | null>(null);
  const [rowDropPosition, setRowDropPosition] = useState<'before' | 'after'>('after');
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  /** Called from the grip handle's onMouseDown */
  const startRowDrag = useCallback((e: React.MouseEvent, dragState: RowDragState) => {
    e.preventDefault();
    e.stopPropagation();
    rowDragStateRef.current = dragState;
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = 'grabbing';

    function onMouseMove(ev: MouseEvent) {
      // Find which registered row the cursor is over
      let bestKey: string | null = null;
      let bestPos: 'before' | 'after' = 'after';
      rowRefs.current.forEach((el, key) => {
        const rect = el.getBoundingClientRect();
        if (ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
          bestKey = key;
          bestPos = ev.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        }
      });
      setRowDropTarget(bestKey);
      setRowDropPosition(bestPos);
    }

    function onMouseUp() {
      const drag       = rowDragStateRef.current;
      const targetKey  = rowDropTarget;   // captured from state — stale closure risk
      // Re-read from DOM instead:
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor     = '';
      rowDragStateRef.current = null;
      setRowDropTarget(null);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Commit the reorder on mouseup.
   * Because rowDropTarget is state we can't reliably read it inside the closure above,
   * so we attach a separate document mouseup that has access to a ref copy.
   */
  const rowDropTargetRef  = useRef<string | null>(null);
  const rowDropPosRef     = useRef<'before' | 'after'>('after');
  rowDropTargetRef.current  = rowDropTarget;
  rowDropPosRef.current     = rowDropPosition;

  // Attach a single stable document mouseup to commit the reorder
  useEffect(() => {
    function commitReorder() {
      const drag      = rowDragStateRef.current;
      const targetKey = rowDropTargetRef.current;
      const pos       = rowDropPosRef.current;
      if (!drag || !targetKey || targetKey === drag.id) return;

      if (drag.kind === 'project') {
        // Reorder projects
        const ids      = projects.map(p => p.id);
        const fromIdx  = ids.indexOf(drag.id);
        let   toIdx    = ids.indexOf(targetKey);
        if (fromIdx === -1 || toIdx === -1) return;
        const newIds = [...ids];
        newIds.splice(fromIdx, 1);
        // Adjust toIdx after removal
        toIdx = newIds.indexOf(targetKey);
        const insertAt = pos === 'after' ? toIdx + 1 : toIdx;
        newIds.splice(insertAt, 0, drag.id);
        dispatch({ type: 'REORDER_PROJECTS', orderedIds: newIds });
      } else {
        // ── Task drag: may be cross-subgroup ────────────────────────────────
        // Determine what the drop target is:
        //   'sg-<id>'   → dropped onto a subgroup header  → move into that subgroup
        //   project id  → dropped onto a project header   → move to top-level (no subgroup)
        //   task id     → dropped onto a sibling task     → reorder within same/new group

        let newSubgroupId: string | null | undefined = undefined; // undefined = no change

        const targetIsSubgroupHeader = targetKey.startsWith('sg-');
        const targetIsProjectHeader  = projects.some(p => p.id === targetKey);
        const targetIsSiblingTask    = !targetIsSubgroupHeader && !targetIsProjectHeader;

        if (targetIsSubgroupHeader) {
          // Extract subgroup id from key 'sg-<subgroupId>'
          newSubgroupId = targetKey.slice(3);
        } else if (targetIsProjectHeader) {
          newSubgroupId = null; // move to top-level
        } else {
          // Dropping onto another task — check what subgroup that task belongs to
          const targetTask = items.find(i => i.id === targetKey);
          if (targetTask) newSubgroupId = targetTask.subgroupId ?? null;
        }

        // If subgroup changed, update the item — also assign a new order so it
        // doesn't collide with items already in the destination group
        if (newSubgroupId !== undefined && newSubgroupId !== (drag.subgroupId ?? null)) {
          const destItems = items.filter(i =>
            i.projectId === drag.projectId && (i.subgroupId ?? null) === newSubgroupId && i.id !== drag.id
          );
          const maxOrder = destItems.length > 0 ? Math.max(...destItems.map(i => i.order ?? 0)) : -1000;
          dispatch({ type: 'UPDATE_ITEM', itemId: drag.id, patch: { subgroupId: newSubgroupId, order: maxOrder + 1000 } });
        }

        // Only reorder if dropping onto a sibling task (not a header)
        if (targetIsSiblingTask) {
          const targetTask = items.find(i => i.id === targetKey);
          if (!targetTask) return;
          // Reorder within the destination subgroup
          const destSubgroup = newSubgroupId !== undefined ? newSubgroupId : (drag.subgroupId ?? null);
          const groupTasks = items.filter(i =>
            i.projectId === drag.projectId &&
            i.type === 'task' &&
            (i.subgroupId ?? null) === destSubgroup &&
            i.id !== drag.id
          ) as GanttTask[];
          const ids = groupTasks.map(t => t.id);
          let toIdx = ids.indexOf(targetKey);
          if (toIdx === -1) return;
          const insertAt = pos === 'after' ? toIdx + 1 : toIdx;
          const newIds = [...ids];
          newIds.splice(insertAt, 0, drag.id);
          dispatch({ type: 'REORDER_ITEMS', projectId: drag.projectId!, subgroupId: destSubgroup, orderedIds: newIds });
        }
      }
    }

    document.addEventListener('mouseup', commitReorder);
    return () => document.removeEventListener('mouseup', commitReorder);
  }, [projects, items, dispatch]);

  // ── Flat row list ─────────────────────────────────────────────────────────────

  const rows: CalendarRow[] = useMemo(() => {
    const result: CalendarRow[] = [];

    /**
     * Push task rows + milestone rows for a given set of items.
     *
     * Milestone rows are split by milestoneRowId:
     *   - Each named MilestoneRow for this project gets its own CalendarRow
     *   - Milestones with no milestoneRowId (legacy or default) go into a fallback row
     *
     * This allows projects to have e.g. "WIP" row, "Release" row, "Gate" row.
     */
    function pushItems(
      projectItems: typeof items,
      project: Project,
      subgroup?: Subgroup
    ) {
      const allTasks   = (projectItems.filter(i => i.type === 'task')      as GanttTask[]).sort((a,b) => (a.order??0)-(b.order??0));
      const milestones = (projectItems.filter(i => i.type === 'milestone') as GanttMilestone[]).sort((a,b) => (a.order??0)-(b.order??0));

      // All project task rows (project-wide, not scoped to subgroup)
      const allProjectTaskRows  = taskRows.filter(r => r.projectId === project.id);
      const validTaskRowIds     = new Set(allProjectTaskRows.map(r => r.id));

      // Independent tasks: no taskRowId, or stale taskRowId
      const independentTasks = allTasks.filter(t => !t.taskRowId || !validTaskRowIds.has(t.taskRowId));
      for (const task of independentTasks) result.push({ kind: 'item', item: task, project, subgroup });

      // Named task rows — only rendered at top level (not inside subgroups) to avoid duplication
      if (!subgroup) {
        for (const tRow of allProjectTaskRows) {
          // Collect tasks from ALL subgroups that are assigned to this row
          const rowTasks = items.filter(i =>
            i.projectId === project.id && i.type === 'task' && i.taskRowId === tRow.id
          ).sort((a,b) => (a.order??0)-(b.order??0)) as GanttTask[];
          result.push({ kind: 'taskrow', tasks: rowTasks, project, taskRow: tRow });
        }
      }

      const tasks = allTasks; // alias for milestone section below

      const projectMilestoneRows = milestoneRows.filter(r => r.projectId === project.id);

      if (projectMilestoneRows.length === 0) {
        // No named rows defined → single default row
        if (milestones.length > 0) result.push({ kind: 'milestones', milestones, project, subgroup });
      } else {
        // One row per named milestone row — only show if it has milestones
        for (const mRow of projectMilestoneRows) {
          const rowMilestones = milestones.filter(m => m.milestoneRowId === mRow.id);
          // Only render the row if it has milestones (avoids empty ghost rows)
          if (rowMilestones.length > 0) {
            result.push({ kind: 'milestones', milestones: rowMilestones, project, subgroup, milestoneRow: mRow });
          }
        }
        // Fallback: milestones not assigned to any named row (or with stale milestoneRowId)
        const validRowIds = new Set(projectMilestoneRows.map(r => r.id));
        const unassigned = milestones.filter(m => !m.milestoneRowId || !validRowIds.has(m.milestoneRowId));
        if (unassigned.length > 0) {
          result.push({ kind: 'milestones', milestones: unassigned, project, subgroup });
        }
      }
    }

    for (const project of projects) {
      result.push({ kind: 'header', project });
      if (project.collapsed) continue;

      const projectSubgroups = subgroups.filter(s => s.projectId === project.id);
      // Build a set of valid subgroup IDs for this project to catch orphaned items
      const validSgIds = new Set(projectSubgroups.map(s => s.id));

      const isTopLevel = (i: typeof items[0]) =>
        i.projectId === project.id && (!i.subgroupId || !validSgIds.has(i.subgroupId));

      // Task rows for this project
      const projectTaskRows = taskRows.filter(r => r.projectId === project.id);
      const validTaskRowIds = new Set(projectTaskRows.map(r => r.id));

      // Independent top-level tasks (no taskRowId or stale taskRowId, no subgroup)
      const topIndependentTasks = (items.filter(i =>
        isTopLevel(i) && i.type === 'task' &&
        (!i.taskRowId || !validTaskRowIds.has(i.taskRowId))
      ) as GanttTask[]).sort((a,b) => (a.order??0)-(b.order??0));
      for (const task of topIndependentTasks) result.push({ kind: 'item', item: task, project });

      // Subgroups (with their own tasks + milestone rows inside)
      for (const sg of projectSubgroups) {
        result.push({ kind: 'subheader', subgroup: sg, project });
        if (!sg.collapsed) {
          const sgItems = items.filter(i => i.projectId === project.id && i.subgroupId === sg.id);
          pushItems(sgItems, project, sg);
        }
      }

      // Named task rows — collect ALL tasks (across subgroups) assigned to each row
      for (const tRow of projectTaskRows) {
        const rowTasks = (items.filter(i =>
          i.projectId === project.id && i.type === 'task' && i.taskRowId === tRow.id
        ) as GanttTask[]).sort((a,b) => (a.order??0)-(b.order??0));
        // Always show the row so tasks can be placed into it
        result.push({ kind: 'taskrow', tasks: rowTasks, project, taskRow: tRow });
      }

      // Project-level milestone rows render LAST
      const topMilestones = (items.filter(i => isTopLevel(i) && i.type === 'milestone') as GanttMilestone[])
        .sort((a,b) => (a.order??0)-(b.order??0));
      const projectMilestoneRows = milestoneRows.filter(r => r.projectId === project.id);
      if (projectMilestoneRows.length === 0) {
        if (topMilestones.length > 0) result.push({ kind: 'milestones', milestones: topMilestones, project });
      } else {
        for (const mRow of projectMilestoneRows) {
          const rowMilestones = topMilestones.filter(m => m.milestoneRowId === mRow.id);
          if (rowMilestones.length > 0)
            result.push({ kind: 'milestones', milestones: rowMilestones, project, milestoneRow: mRow });
        }
        const validRowIds = new Set(projectMilestoneRows.map(r => r.id));
        const unassigned = topMilestones.filter(m => !m.milestoneRowId || !validRowIds.has(m.milestoneRowId));
        if (unassigned.length > 0) result.push({ kind: 'milestones', milestones: unassigned, project });
      }
    }
    return result;
  }, [projects, subgroups, items, milestoneRows, taskRows]);

  const columns = useMemo(
    () => viewMode === 'daily' ? buildDailyColumns(calStartDate, numCols) : buildWeeklyColumns(calStartDate, numCols),
    [calStartDate, viewMode, numCols]
  );

  const totalCalWidth = numCols * colWidth;
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // ── Detail panel ──────────────────────────────────────────────────────────────
  const [detailPanel, setDetailPanel] = useState<{
    item: GanttTask | GanttMilestone;
    color: string;
    projectColor: string;
    anchorRect: DOMRect;
  } | null>(null);

  const openDetail = useCallback((item: GanttTask | GanttMilestone, projectColor: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const clickRect = new DOMRect(e.clientX, e.clientY, 0, 0);
    const effectiveColor = (item as GanttTask | GanttMilestone & { color?: string }).color ?? projectColor;
    setDetailPanel({ item, color: effectiveColor, projectColor, anchorRect: clickRect });
  }, []);

  const closeDetail = useCallback(() => setDetailPanel(null), []);

  // ── Vacation context menu ─────────────────────────────────────────────────────
  const [vacMenu, setVacMenu] = useState<{ x: number; y: number; date: string; projectId: string; subgroupId?: string | null; taskRowId?: string | null } | null>(null);
  // Track whether a context menu event came from our calendar so we can
  // distinguish it from right-clicks elsewhere (which should close our menu)
  const contextMenuFromCalendar = useRef(false);

  // Close our custom menu whenever the browser fires a context menu outside our calendar
  useEffect(() => {
    function onDocContextMenu() {
      if (!contextMenuFromCalendar.current) {
        setVacMenu(null);
        setQuickAdd(null);
      }
      contextMenuFromCalendar.current = false;
    }
    document.addEventListener('contextmenu', onDocContextMenu);
    return () => document.removeEventListener('contextmenu', onDocContextMenu);
  }, []);
  const [vacForm, setVacForm] = useState<{ startDate: string; endDate: string; name: string } | null>(null);
  // quickAdd: inline form spawned from right-click for adding a task or milestone
  const [quickAdd, setQuickAdd] = useState<{
    type: 'task' | 'milestone';
    date: string;
    x: number; y: number;
    name: string;
    projectId: string;
    subgroupId: string;   // '' = no subgroup (top-level)
    milestoneRowId: string;
  } | null>(null);

  /**
   * Find which project/subgroup the cursor Y position belongs to by walking
   * the flat rows array and accumulating row heights — much more precise than
   * DOM rect scanning which misses unregistered rows (milestone rows, etc.).
   */
  const getRowContextFromY = useCallback((clientY: number): { projectId: string; subgroupId?: string | null; taskRowId?: string | null } => {
    const container = ganttScrollRef.current;
    if (!container || rows.length === 0) {
      return { projectId: projects[0]?.id ?? '', subgroupId: null };
    }

    // The calendar area starts after the header — find its top offset
    const containerRect = container.getBoundingClientRect();
    // scrollTop accounts for vertical scroll
    const relativeY = clientY - containerRect.top + container.scrollTop - HEADER_H;

    let accumulated = 0;
    let currentProjectId = projects[0]?.id ?? '';
    let currentSubgroupId: string | null = null;

    for (const row of rows) {
      const rowHeight = row.kind === 'milestones' ? MILESTONE_ROW_H : ROW_H;
      if (relativeY < accumulated + rowHeight) {
        if (row.kind === 'header') {
          currentProjectId  = row.project.id;
          currentSubgroupId = null;
        } else if (row.kind === 'subheader') {
          currentProjectId  = row.project.id;
          currentSubgroupId = row.subgroup.id;
        } else if (row.kind === 'taskrow') {
          currentProjectId  = row.project.id;
          currentSubgroupId = row.subgroup?.id ?? null;
          return { projectId: currentProjectId, subgroupId: currentSubgroupId, taskRowId: row.taskRow.id };
        } else {
          currentProjectId  = row.project.id;
          currentSubgroupId = row.subgroup?.id ?? null;
        }
        break;
      }
      if (row.kind === 'header') {
        currentProjectId  = row.project.id;
        currentSubgroupId = null;
      } else if (row.kind === 'subheader') {
        currentSubgroupId = row.subgroup.id;
      } else {
        currentProjectId  = row.project.id;
        currentSubgroupId = row.subgroup?.id ?? null;
      }
      accumulated += rowHeight;
    }

    return { projectId: currentProjectId, subgroupId: currentSubgroupId, taskRowId: null };
  }, [rows, projects, ganttScrollRef]);

  /** Returns true if the given ISO date falls within any vacation period */
  const isVacationDate = useCallback((date: string): boolean => {
    return vacations.some(v => date >= v.startDate && date <= v.endDate);
  }, [vacations]);

  const saveDetail = useCallback((itemId: string, description: string) => {
    dispatch({ type: 'UPDATE_ITEM', itemId, patch: { description } });
  }, [dispatch]);

  const saveDetailColor = useCallback((itemId: string, color: string | null) => {
    dispatch({ type: 'UPDATE_ITEM', itemId, patch: { color: color ?? undefined } });
  }, [dispatch]);

  const saveDetailName = useCallback((itemId: string, name: string) => {
    if (name.trim()) dispatch({ type: 'UPDATE_ITEM', itemId, patch: { name: name.trim() } });
  }, [dispatch]);

  // ── Click handlers ────────────────────────────────────────────────────────────

  const handleTaskRowClick = useCallback((e: React.MouseEvent<HTMLDivElement>, task: GanttTask, rowEl: HTMLDivElement) => {
    if (calDragStateRef.current || calDragPreviewRef.current) return;
    const dayOffset   = Math.floor((e.clientX - rowEl.getBoundingClientRect().left) / ppd);
    const clickedDate = formatDate(addDays(calStartDate, dayOffset));
    if (isVacationDate(clickedDate)) return; // blocked by vacation
    if (!task.startDate) {
      dispatch({ type: 'UPDATE_ITEM', itemId: task.id, patch: { startDate: clickedDate, endDate: null } });
    } else if (!task.endDate) {
      if (clickedDate >= task.startDate) dispatch({ type: 'UPDATE_ITEM', itemId: task.id, patch: { endDate: clickedDate } });
      else dispatch({ type: 'UPDATE_ITEM', itemId: task.id, patch: { startDate: clickedDate, endDate: null } });
    }
  }, [calStartDate, ppd, dispatch]);

  const handleMilestonesRowClick = useCallback((e: React.MouseEvent<HTMLDivElement>, milestones: GanttMilestone[], rowEl: HTMLDivElement) => {
    if (calDragStateRef.current || calDragPreviewRef.current) return;
    const firstUnplaced = milestones.find(m => m.date === null);
    if (!firstUnplaced) return;
    const dayOffset   = Math.floor((e.clientX - rowEl.getBoundingClientRect().left) / ppd);
    const clickedDate = formatDate(addDays(calStartDate, dayOffset));
    if (isVacationDate(clickedDate)) return; // blocked by vacation
    dispatch({ type: 'UPDATE_ITEM', itemId: firstUnplaced.id, patch: { date: clickedDate } });
  }, [calStartDate, ppd, dispatch]);

  const todayOffset  = dayDiff(calStartDate, new Date()) * ppd;
  const todayVisible = todayOffset >= 0 && todayOffset <= totalCalWidth;
  const calDragPreview = calDragPreviewRef.current;
  void calDragTick;

  return (
    <>
    <div ref={ganttScrollRef} className='gantt-scroll' onContextMenu={e => e.preventDefault()} style={{ flex: 1, overflow: 'auto', display: 'flex', background: 'var(--bg-surface)' }}>
      <div style={{ display: 'flex', minWidth: LEFT_W + totalCalWidth, minHeight: '100%' }}>

        {/* ── LEFT PANEL ───────────────────────────────────────────────────── */}
        <div style={{ position: 'sticky', left: 0, width: LEFT_W, flexShrink: 0, background: 'var(--bg-surface)', borderRight: '1.5px solid var(--border-strong)', zIndex: 10, display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: HEADER_H, display: 'flex', alignItems: 'center', paddingLeft: 16, borderBottom: '1.5px solid var(--border-strong)', background: 'var(--bg-header)', position: 'sticky', top: 0, zIndex: 11 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Projects / Tasks</span>
          </div>

          {rows.map((row, rowIndex) => {
            if (row.kind === 'header') {
              const key = row.project.id;
              const isProjectDrag = rowDragStateRef.current?.kind === 'project';
              const isTaskDragOnProject = rowDragStateRef.current?.kind === 'task' && rowDropTarget === row.project.id;
              const showDropBefore = rowDropTarget === key && rowDropPosition === 'before' && isProjectDrag;
              const showDropAfter  = rowDropTarget === key && rowDropPosition === 'after'  && isProjectDrag;
              return (
                <React.Fragment key={key}>
                  {showDropBefore && <DropIndicator color={row.project.color} />}
                  <LeftPanelHeader
                    ref={el => {
                      if (el) {
                        rowRefs.current.set(key, el);
                        // Also register with project id so tasks can be dropped onto project header
                        rowRefs.current.set(row.project.id, el);
                      } else {
                        rowRefs.current.delete(key);
                        rowRefs.current.delete(row.project.id);
                      }
                    }}
                    project={row.project} rowH={ROW_H}
                    onToggle={() => dispatch({ type: 'TOGGLE_COLLAPSE', projectId: row.project.id })}
                    onDelete={() => dispatch({ type: 'DELETE_PROJECT', projectId: row.project.id })}
                    onGripMouseDown={e => startRowDrag(e, { kind: 'project', id: row.project.id })}
                    isDragOver={rowDropTarget === key || isTaskDragOnProject}
                  />
                  {showDropAfter && <DropIndicator color={row.project.color} />}
                </React.Fragment>
              );
            }

            if (row.kind === 'item') {
              const key       = row.item.id;
              const projectId = row.project.id;
              const isDragKindTask = rowDragStateRef.current?.kind === 'task' && rowDragStateRef.current?.projectId === projectId;
              const showDropBefore = rowDropTarget === key && rowDropPosition === 'before' && isDragKindTask;
              const showDropAfter  = rowDropTarget === key && rowDropPosition === 'after'  && isDragKindTask;
              return (
                <React.Fragment key={key}>
                  {showDropBefore && <DropIndicator color={row.project.color} />}
                  <LeftPanelTaskRow
                    ref={el => { if (el) rowRefs.current.set(key, el); else rowRefs.current.delete(key); }}
                    row={row} rowH={ROW_H}
                    isHovered={hoveredKey === key}
                    onHover={setHoveredKey}
                    onDelete={() => dispatch({ type: 'DELETE_ITEM', itemId: row.item.id })}
                    onGripMouseDown={e => startRowDrag(e, { kind: 'task', id: row.item.id, projectId: row.project.id, subgroupId: row.item.subgroupId ?? null })}
                  />
                  {showDropAfter && <DropIndicator color={row.project.color} />}
                </React.Fragment>
              );
            }

            if (row.kind === 'taskrow') {
              const key = `tr-${row.taskRow.id}`;
              return (
                <LeftPanelTaskRowGroup
                  key={key}
                  row={row}
                  rowH={ROW_H}
                  isHovered={hoveredKey === key}
                  onHover={setHoveredKey}
                  onDeleteTask={id => dispatch({ type: 'DELETE_ITEM', itemId: id })}
                  onDeleteRow={() => dispatch({ type: 'DELETE_TASK_ROW', taskRowId: row.taskRow.id })}
                />
              );
            }

            if (row.kind === 'subheader') {
              const key = `sg-${row.subgroup.id}`;
              const isTaskDrag = rowDragStateRef.current?.kind === 'task';
              const showDropBefore = rowDropTarget === key && rowDropPosition === 'before' && isTaskDrag;
              const showDropAfter  = rowDropTarget === key && rowDropPosition === 'after'  && isTaskDrag;
              return (
                <React.Fragment key={key}>
                  {showDropBefore && <DropIndicator color={row.project.color} />}
                  <LeftPanelSubgroupHeader
                    ref={el => { if (el) rowRefs.current.set(key, el); else rowRefs.current.delete(key); }}
                    subgroup={row.subgroup}
                    project={row.project}
                    rowH={ROW_H}
                    isDragOver={rowDropTarget === key && isTaskDrag}
                    onToggle={() => dispatch({ type: 'TOGGLE_SUBGROUP_COLLAPSE', subgroupId: row.subgroup.id })}
                    onDelete={() => dispatch({ type: 'DELETE_SUBGROUP', subgroupId: row.subgroup.id })}
                  />
                  {showDropAfter && <DropIndicator color={row.project.color} />}
                </React.Fragment>
              );
            }

            // milestones row — not reorderable (always last in project/subgroup)
            {
              const rowKey = `ms-${row.project.id}-${row.subgroup?.id ?? 'top'}-${row.milestoneRow?.id ?? 'default'}`;
              return (
                <LeftPanelMilestonesRow
                  key={rowKey}
                  row={row} rowH={MILESTONE_ROW_H}
                  isHovered={hoveredKey === rowKey}
                  onHover={setHoveredKey}
                  onDeleteMilestone={id => dispatch({ type: 'DELETE_ITEM', itemId: id })}
                  onDeleteRow={row.milestoneRow ? () => dispatch({ type: 'DELETE_MILESTONE_ROW', milestoneRowId: row.milestoneRow!.id }) : undefined}
                />
              );
            }
          })}
        </div>

        {/* ── CALENDAR AREA ────────────────────────────────────────────────── */}
        <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <div
            onContextMenu={e => {
              e.preventDefault();
              contextMenuFromCalendar.current = true;
              setQuickAdd(null); // close any open quick-add form
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const dayOffset = Math.floor((e.clientX - rect.left) / ppd);
              const date = formatDate(addDays(calStartDate, dayOffset));
              const ctx = getRowContextFromY(e.clientY);
              setVacMenu({ x: e.clientX, y: e.clientY, date, ...ctx });
            }}
          >
            <CalendarHeader columns={columns} viewMode={viewMode} colWidth={colWidth} todayDate={today} />
          </div>

          <div
          style={{ position: 'relative', flex: 1 }}
          onContextMenu={e => {
            e.preventDefault();
            contextMenuFromCalendar.current = true;
            setQuickAdd(null); // close any open quick-add form
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const dayOffset = Math.floor((e.clientX - rect.left) / ppd);
            const date = formatDate(addDays(calStartDate, dayOffset));
            const ctx = getRowContextFromY(e.clientY);
            setVacMenu({ x: e.clientX, y: e.clientY, date, ...ctx });
          }}
        >
            {todayVisible && (
              <div style={{ position: 'absolute', left: todayOffset, top: 0, bottom: 0, width: 2, background: 'var(--accent)', opacity: 0.5, zIndex: 3, pointerEvents: 'none' }} />
            )}

            {/* ── Vacation overlays ── */}
            {vacations.map(v => {
              const left  = dayDiff(calStartDate, parseDate(v.startDate)) * ppd;
              const right = dayDiff(calStartDate, parseDate(v.endDate))   * ppd + ppd;
              const width = right - left;
              if (width <= 0) return null;
              return (
                <div
                  key={v.id}
                  title={v.name + ': ' + v.startDate + ' to ' + v.endDate + ' (click to delete)'}
                  onClick={() => { if (window.confirm('Delete vacation: ' + v.name)) dispatch({ type: 'DELETE_VACATION', vacationId: v.id }); }}
                  style={{
                    position: 'absolute', left, top: 0, bottom: 0, width,
                    background: 'repeating-linear-gradient(45deg, rgba(239,68,68,0.07) 0px, rgba(239,68,68,0.07) 8px, rgba(239,68,68,0.13) 8px, rgba(239,68,68,0.13) 16px)',
                    borderLeft:  '2px solid rgba(239,68,68,0.4)',
                    borderRight: '2px solid rgba(239,68,68,0.4)',
                    zIndex: 4, cursor: 'pointer', pointerEvents: 'auto',
                  }}
                >
                  <div style={{ position: 'sticky', left: 0, padding: '4px 6px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(239,68,68,0.8)', whiteSpace: 'nowrap', background: 'rgba(255,255,255,0.85)', padding: '2px 6px', borderRadius: 4 }}>
                      🏖 {v.name}
                    </span>
                  </div>
                </div>
              );
            })}

            {rows.map(row => {
              if (row.kind === 'header') {
                return <CalendarSwimLaneRow key={row.project.id} totalWidth={totalCalWidth} rowH={ROW_H} columns={columns} colWidth={colWidth} />;
              }

              if (row.kind === 'item') {
                const task    = row.item;
                const preview = calDragPreview?.itemId === task.id
                  ? { startDate: calDragPreview.startDate, endDate: calDragPreview.endDate }
                  : undefined;
                return (
                  <CalendarTaskRow
                    key={task.id} task={task} project={row.project}
                    rowH={ROW_H} totalWidth={totalCalWidth}
                    calStartDate={calStartDate} ppd={ppd}
                    columns={columns} colWidth={colWidth}
                    isHovered={hoveredKey === task.id}
                    isHalf={!!task.startDate && !task.endDate}
                    preview={preview}
                    onHover={setHoveredKey}
                    onRowClick={handleTaskRowClick}
                    onDragStart={(e, kind) => startCalDrag(e, kind, task)}
                    onBarClick={e => openDetail(task, task.color ?? row.project.color, e)}
                    today={today}
                  />
                );
              }

              if (row.kind === 'taskrow') {
                return (
                  <CalendarTaskRowGroup
                    key={`tr-${row.taskRow.id}`}
                    tasks={row.tasks}
                    taskRow={row.taskRow}
                    project={row.project}
                    rowH={ROW_H}
                    totalWidth={totalCalWidth}
                    calStartDate={calStartDate}
                    ppd={ppd}
                    columns={columns}
                    colWidth={colWidth}
                    isHovered={hoveredKey === `tr-${row.taskRow.id}`}
                    onHover={setHoveredKey}
                    onBarClick={(e, task) => openDetail(task, task.color ?? row.project.color, e)}
                    onRowClick={handleTaskRowClick}
                    onDragStart={(e, kind, task) => startCalDrag(e, kind, task)}
                    dragPreview={calDragPreview}
                    today={today}
                  />
                );
              }

              if (row.kind === 'subheader') {
                return (
                  <CalendarSubgroupRow
                    key={`sg-${row.subgroup.id}`}
                    subgroup={row.subgroup}
                    project={row.project}
                    totalWidth={totalCalWidth}
                    rowH={ROW_H}
                    columns={columns}
                    colWidth={colWidth}
                  />
                );
              }

              return (
                <CalendarMilestonesRow
                  key={`ms-${row.project.id}-${row.subgroup?.id ?? 'top'}-${row.milestoneRow?.id ?? 'default'}`}
                  milestones={row.milestones} project={row.project}
                  rowH={MILESTONE_ROW_H} totalWidth={totalCalWidth}
                  calStartDate={calStartDate} ppd={ppd}
                  columns={columns} colWidth={colWidth}
                  isHovered={hoveredKey === `ms-${row.project.id}-${row.subgroup?.id ?? 'top'}-${row.milestoneRow?.id ?? 'default'}`}
                  onHover={id => setHoveredKey(id)}
                  onRowClick={handleMilestonesRowClick}
                  onMilestoneDragStart={(e, m) => startCalDrag(e, 'move-milestone', m)}
                  onMilestoneLabelClick={(e, m) => openDetail(m, m.color ?? row.project.color, e)}
                  milestoneRow={row.milestoneRow}
                  dragPreview={calDragPreview}
                  today={today}
                />
              );
            })}

            {rows.length === 0 && (
              <div style={{ padding: '60px 40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
                <p style={{ fontWeight: 600, marginBottom: 6 }}>No swim lanes yet</p>
                <p>Click <strong>+ Add Swim Lane</strong> in the toolbar to get started.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Zoom controls — fixed bottom-left of calendar area */}
    <div style={{
      position: 'fixed', bottom: 20, left: 'calc(280px + 16px)', zIndex: 60,
      display: 'flex', alignItems: 'center', gap: 2,
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '3px 4px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    }}>
      <button
        onClick={() => setZoomIdx(i => Math.max(0, i - 1))}
        disabled={zoomIdx === 0}
        title="Zoom out"
        style={{ width: 24, height: 24, borderRadius: 5, fontSize: 16, fontWeight: 700, color: 'var(--text-secondary)', opacity: zoomIdx === 0 ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >−</button>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', minWidth: 34, textAlign: 'center' }}>
        {ZOOM_LABELS[zoomIdx]}
      </span>
      <button
        onClick={() => setZoomIdx(i => Math.min(ZOOM_LEVELS.length - 1, i + 1))}
        disabled={zoomIdx === ZOOM_LEVELS.length - 1}
        title="Zoom in"
        style={{ width: 24, height: 24, borderRadius: 5, fontSize: 16, fontWeight: 700, color: 'var(--text-secondary)', opacity: zoomIdx === ZOOM_LEVELS.length - 1 ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >＋</button>
    </div>

    {/* Right-click context menu */}
    {vacMenu && (
      <>
        <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setVacMenu(null)} />
        <div style={{
          position: 'fixed', left: Math.min(vacMenu.x, window.innerWidth - 220), top: Math.min(vacMenu.y, window.innerHeight - 200),
          zIndex: 200, background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          padding: 4, minWidth: 200,
        }}>
          {/* Date + project label */}
          <div style={{ padding: '4px 12px 6px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
            <div>📅 {vacMenu.date}</div>
            {vacMenu.projectId && (() => {
              const p = projects.find(p => p.id === vacMenu.projectId);
              return p ? <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 7, height: 7, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 600, color: p.color }}>{p.name}</span>
              </div> : null;
            })()}
          </div>

          {/* Add Task */}
          <CtxMenuItem icon="▬" label="Add Task here" onClick={() => {
            setQuickAdd({ type: 'task', date: vacMenu.date, x: vacMenu.x, y: vacMenu.y, name: '', projectId: vacMenu.projectId || (projects[0]?.id ?? ''), subgroupId: vacMenu.subgroupId ?? '', milestoneRowId: vacMenu.taskRowId ?? '' });
            setVacMenu(null);
          }} />

          {/* Add Milestone */}
          <CtxMenuItem icon="◆" label="Add Milestone here" onClick={() => {
            setQuickAdd({ type: 'milestone', date: vacMenu.date, x: vacMenu.x, y: vacMenu.y, name: '', projectId: vacMenu.projectId || (projects[0]?.id ?? ''), subgroupId: vacMenu.subgroupId ?? '', milestoneRowId: '' });
            setVacMenu(null);
          }} />

          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

          {/* Add Vacation */}
          <CtxMenuItem icon="🏖" label="Add vacation period" onClick={() => {
            setVacForm({ startDate: vacMenu.date, endDate: vacMenu.date, name: '' });
            setVacMenu(null);
          }} />
        </div>
      </>
    )}

    {/* Quick-add task/milestone inline modal */}
    {quickAdd && (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 300 }}
        onClick={() => setQuickAdd(null)}
        onContextMenu={e => {
          e.preventDefault();
          e.stopPropagation();
          setQuickAdd(null);
          // Re-fire as a synthetic contextmenu on the element underneath
          // so our calendar handler picks it up at the correct position
          setTimeout(() => {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (el) {
              const evt = new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true,
                clientX: e.clientX, clientY: e.clientY,
                button: 2,
              });
              el.dispatchEvent(evt);
            }
          }, 0);
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: Math.min(quickAdd.x, window.innerWidth - 300),
            top: Math.min(quickAdd.y, window.innerHeight - 240),
            width: 280,
            background: 'var(--bg-surface)',
            border: '1.5px solid var(--accent)',
            borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            padding: 16,
            display: 'flex', flexDirection: 'column', gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>{quickAdd.type === 'task' ? '▬' : '◆'}</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
              Add {quickAdd.type === 'task' ? 'Task' : 'Milestone'}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
              {quickAdd.date}
            </span>
          </div>

          {/* Name */}
          <input
            autoFocus
            className="form-input"
            placeholder={quickAdd.type === 'task' ? 'Task name…' : 'Milestone name…'}
            value={quickAdd.name}
            onChange={e => setQuickAdd(q => q && ({ ...q, name: e.target.value }))}
            onKeyDown={e => {
              if (e.key === 'Escape') { setQuickAdd(null); return; }
              if (e.key === 'Enter') {
                const name = quickAdd.name.trim();
                if (!name || !quickAdd.projectId) return;
                if (quickAdd.type === 'task') {
                  dispatch({ type: 'ADD_ITEM', item: { id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`, type: 'task', userId: '', timelineId: '', projectId: quickAdd.projectId, subgroupId: quickAdd.subgroupId || null, taskRowId: quickAdd.milestoneRowId || null, name, startDate: quickAdd.date, endDate: null, order: 0 } });
                } else {
                  dispatch({ type: 'ADD_ITEM', item: { id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`, type: 'milestone', userId: '', timelineId: '', projectId: quickAdd.projectId, subgroupId: quickAdd.subgroupId || null, milestoneRowId: quickAdd.milestoneRowId || null, name, date: quickAdd.date, order: 0 } });
                }
                setQuickAdd(null);
              }
            }}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />

          {/* Project selector */}
          {projects.length > 1 && (
            <select
              className="form-input"
              value={quickAdd.projectId}
              onChange={e => setQuickAdd(q => q && ({ ...q, projectId: e.target.value, subgroupId: '', milestoneRowId: '' }))}
              style={{ appearance: 'auto', width: '100%', boxSizing: 'border-box' }}
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}

          {/* Subgroup selector */}
          {(() => {
            const sgs = subgroups.filter(s => s.projectId === quickAdd.projectId);
            if (sgs.length === 0) return null;
            return (
              <select
                className="form-input"
                value={quickAdd.subgroupId}
                onChange={e => setQuickAdd(q => q && ({ ...q, subgroupId: e.target.value }))}
                style={{ appearance: 'auto', width: '100%', boxSizing: 'border-box' }}
              >
                <option value="">— No subgroup (top-level) —</option>
                {sgs.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            );
          })()}

          {/* Task row selector */}
          {quickAdd.type === 'task' && (() => {
            const rows = taskRows.filter(r => r.projectId === quickAdd.projectId);
            if (rows.length === 0) return null;
            return (
              <select
                className="form-input"
                value={quickAdd.milestoneRowId}
                onChange={e => setQuickAdd(q => q && ({ ...q, milestoneRowId: e.target.value }))}
                style={{ appearance: 'auto', width: '100%', boxSizing: 'border-box' }}
              >
                <option value="">— Independent row (default) —</option>
                {rows.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            );
          })()}

          {/* Milestone row selector */}
          {quickAdd.type === 'milestone' && (() => {
            const rows = milestoneRows.filter(r => r.projectId === quickAdd.projectId);
            if (rows.length === 0) return null;
            return (
              <select
                className="form-input"
                value={quickAdd.milestoneRowId}
                onChange={e => setQuickAdd(q => q && ({ ...q, milestoneRowId: e.target.value }))}
                style={{ appearance: 'auto', width: '100%', boxSizing: 'border-box' }}
              >
                <option value="">◆ Default row</option>
                {rows.map(r => (
                  <option key={r.id} value={r.id}>{r.icon} {r.name}</option>
                ))}
              </select>
            );
          })()}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setQuickAdd(null)}>Cancel</button>
            <button
              className="btn-primary" style={{ flex: 2, opacity: quickAdd.name.trim() ? 1 : 0.5 }}
              disabled={!quickAdd.name.trim() || !quickAdd.projectId}
              onClick={() => {
                const name = quickAdd.name.trim();
                if (!name || !quickAdd.projectId) return;
                if (quickAdd.type === 'task') {
                  dispatch({ type: 'ADD_ITEM', item: { id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`, type: 'task', userId: '', timelineId: '', projectId: quickAdd.projectId, subgroupId: quickAdd.subgroupId || null, taskRowId: quickAdd.milestoneRowId || null, name, startDate: quickAdd.date, endDate: null, order: 0 } });
                } else {
                  dispatch({ type: 'ADD_ITEM', item: { id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`, type: 'milestone', userId: '', timelineId: '', projectId: quickAdd.projectId, subgroupId: quickAdd.subgroupId || null, milestoneRowId: quickAdd.milestoneRowId || null, name, date: quickAdd.date, order: 0 } });
                }
                setQuickAdd(null);
              }}
            >
              Add {quickAdd.type === 'task' ? 'Task' : 'Milestone'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Vacation form modal */}
    {vacForm && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={() => setVacForm(null)}>
        <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 24, width: 340, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
          onClick={e => e.stopPropagation()}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            🏖 Add Vacation Period
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Name</label>
              <input
                autoFocus
                className="form-input"
                placeholder="e.g. Summer break, Public holiday…"
                value={vacForm.name}
                onChange={e => setVacForm(f => f && ({ ...f, name: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Start date</label>
                <input
                  type="date" className="form-input"
                  value={vacForm.startDate}
                  onChange={e => setVacForm(f => f && ({ ...f, startDate: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>End date</label>
                <input
                  type="date" className="form-input"
                  value={vacForm.endDate}
                  min={vacForm.startDate}
                  onChange={e => setVacForm(f => f && ({ ...f, endDate: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
            <button className="btn-ghost" onClick={() => setVacForm(null)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={!vacForm.name.trim() || !vacForm.startDate || !vacForm.endDate}
              style={{ opacity: vacForm.name.trim() ? 1 : 0.5 }}
              onClick={() => {
                if (!vacForm.name.trim()) return;
                dispatch({
                  type: 'ADD_VACATION',
                  vacation: {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
                    userId: '',   // stamped by GanttContext dispatchWithSync
                    timelineId: '',
                    name: vacForm.name.trim(),
                    startDate: vacForm.startDate,
                    endDate: vacForm.endDate <= vacForm.startDate ? vacForm.startDate : vacForm.endDate,
                  },
                });
                setVacForm(null);
              }}
            >
              Add Vacation
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Detail panel — floats above everything */}
    {detailPanel && (
      <DetailPanel
        item={detailPanel.item}
        color={detailPanel.color}
        projectColor={detailPanel.projectColor}
        anchorRect={detailPanel.anchorRect}
        onClose={closeDetail}
        onSave={desc => saveDetail(detailPanel.item.id, desc)}
        onSaveColor={color => saveDetailColor(detailPanel.item.id, color)}
        onSaveName={name => saveDetailName(detailPanel.item.id, name)}
      />
    )}
    </>
  );
}

// ─── Left Panel: Project Header ───────────────────────────────────────────────

const LeftPanelHeader = React.forwardRef<HTMLDivElement, {
  project: Project; rowH: number; onToggle: () => void; onDelete: () => void;
  onGripMouseDown: (e: React.MouseEvent) => void; isDragOver: boolean;
}>(({ project, rowH, onToggle, onDelete, onGripMouseDown, isDragOver }, ref) => {
  const [showDelete, setShowDelete] = useState(false);
  return (
    <div
      ref={ref}
      style={{
        height: rowH, display: 'flex', alignItems: 'center',
        paddingLeft: 6, paddingRight: 8, gap: 4,
        background: isDragOver ? project.color + '18' : 'var(--bg-swimlane)',
        borderBottom: '1px solid var(--border)',
        userSelect: 'none', transition: 'background 0.1s',
      }}
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
    >
      <GripHandle onMouseDown={onGripMouseDown} />
      <span
        style={{ fontSize: 9, color: project.color, transform: project.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-block', flexShrink: 0, cursor: 'pointer' }}
        onClick={onToggle}
      >▼</span>
      <div style={{ width: 10, height: 10, borderRadius: 3, background: project.color, flexShrink: 0 }} />
      <span
        style={{ flex: 1, fontWeight: 700, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
        onClick={onToggle}
      >{project.name}</span>
      {showDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ width: 20, height: 20, borderRadius: 4, background: '#fee2e2', color: '#ef4444', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >×</button>
      )}
    </div>
  );
});
LeftPanelHeader.displayName = 'LeftPanelHeader';

// ─── Left Panel: Task Row ─────────────────────────────────────────────────────

const LeftPanelTaskRow = React.forwardRef<HTMLDivElement, {
  row: CalendarRow & { kind: 'item' }; rowH: number;
  isHovered: boolean; onHover: (id: string | null) => void; onDelete: () => void;
  onGripMouseDown: (e: React.MouseEvent) => void;
}>(({ row, rowH, isHovered, onHover, onDelete, onGripMouseDown }, ref) => {
  const { item, project } = row;
  return (
    <div
      ref={ref}
      style={{
        height: rowH, display: 'flex', alignItems: 'center',
        paddingLeft: 6, paddingRight: 8, gap: 4,
        background: isHovered ? 'var(--bg-row-hover)' : 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)', transition: 'background 0.1s',
      }}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
    >
      <GripHandle onMouseDown={onGripMouseDown} />
      <div style={{ width: 12, height: 5, background: (item as any).color ?? project.color, borderRadius: 2, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.name}
      </span>
      {isHovered && (
        <button onClick={onDelete} style={{ width: 18, height: 18, borderRadius: 4, background: '#fee2e2', color: '#ef4444', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
      )}
    </div>
  );
});
LeftPanelTaskRow.displayName = 'LeftPanelTaskRow';

// ─── Left Panel: Milestones Row ───────────────────────────────────────────────

function LeftPanelMilestonesRow({ row, rowH, isHovered, onHover, onDeleteMilestone, onDeleteRow }: {
  row: CalendarRow & { kind: 'milestones' }; rowH: number;
  isHovered: boolean; onHover: (key: string | null) => void;
  onDeleteMilestone: (id: string) => void;
  onDeleteRow?: () => void;
}) {
  const { milestones, project, milestoneRow } = row;
  const rowKey        = `ms-${project.id}-${row.subgroup?.id ?? 'top'}-${milestoneRow?.id ?? 'default'}`;
  const unplacedCount = milestones.filter(m => m.date === null).length;
  const placedCount   = milestones.filter(m => m.date !== null).length;
  const icon          = milestoneRow?.icon ?? '◆';
  const label         = milestoneRow?.name ?? 'Milestones';

  // Single fixed-height row — no list of names (they show on the calendar as labels)
  // On hover show a tooltip-style popup listing names instead of expanding the row
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      style={{ height: rowH, display: 'flex', alignItems: 'center', paddingLeft: 28, paddingRight: 8, gap: 6, position: 'relative',
        background: isHovered ? 'var(--bg-row-hover)' : 'var(--bg-surface)', borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}
      onMouseEnter={() => { onHover(rowKey); setShowTooltip(true); }}
      onMouseLeave={() => { onHover(null); setShowTooltip(false); }}
    >
      {/* Icon */}
      <span style={{ fontSize: 12, flexShrink: 0 }}>{icon}</span>

      {/* Label */}
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>

      {/* Count badges */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {placedCount > 0 && (
          <span style={{ fontSize: 10, fontWeight: 600, color: project.color, background: project.color + '18', borderRadius: 10, padding: '1px 6px' }}>
            {placedCount}
          </span>
        )}
        {unplacedCount > 0 && (
          <span style={{ fontSize: 10, fontWeight: 600, color: '#f59e0b', background: '#fef3c7', borderRadius: 10, padding: '1px 6px' }}>
            +{unplacedCount}
          </span>
        )}
      </div>

      {/* Delete row button */}
      {isHovered && onDeleteRow && (
        <button
          onClick={e => { e.stopPropagation(); if (window.confirm('Delete this milestone row?')) onDeleteRow(); }}
          style={{ width: 16, height: 16, borderRadius: 3, background: '#fee2e2', color: '#ef4444', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >×</button>
      )}

      {/* Hover tooltip listing milestone names + delete buttons */}
      {showTooltip && milestones.length > 0 && (
        <div style={{
          position: 'absolute', left: 0, top: '100%', zIndex: 50, width: '100%',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderTop: 'none', borderRadius: '0 0 8px 8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          padding: '4px 0',
        }}>
          {milestones.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px' }}
              onMouseEnter={e => e.stopPropagation()}
            >
              <span style={{ fontSize: 10, flexShrink: 0, opacity: 0.6 }}>{icon}</span>
              <span style={{ fontSize: 11, flex: 1, color: m.date ? 'var(--text-primary)' : 'var(--text-muted)',
                fontStyle: m.date ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.name}{!m.date ? ' (unplaced)' : ''}
              </span>
              <button onClick={() => onDeleteMilestone(m.id)}
                style={{ width: 14, height: 14, borderRadius: 3, background: '#fee2e2', color: '#ef4444', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Calendar: Background Row ─────────────────────────────────────────────────

function CalendarSwimLaneRow({ totalWidth, rowH, columns, colWidth }: { totalWidth: number; rowH: number; columns: Date[]; colWidth: number }) {
  return (
    <div style={{ height: rowH, width: totalWidth, background: 'var(--bg-swimlane)', borderBottom: '1px solid var(--border)', display: 'flex' }}>
      {columns.map((col, i) => (
        <div key={i} style={{ width: colWidth, height: '100%', borderRight: '1px solid var(--border)', background: isWeekend(col) && colWidth < 50 ? '#f9fafb' : 'transparent' }} />
      ))}
    </div>
  );
}

// ─── Calendar: Task Row ───────────────────────────────────────────────────────

function CalendarTaskRow({ task, project, rowH, totalWidth, calStartDate, ppd, columns, colWidth, isHovered, isHalf, preview, onHover, onRowClick, onDragStart, onBarClick, today }: {
  task: GanttTask; project: Project; rowH: number; totalWidth: number; calStartDate: Date; ppd: number;
  columns: Date[]; colWidth: number; isHovered: boolean; isHalf: boolean;
  preview?: { startDate: string | null; endDate: string | null };
  onHover: (id: string | null) => void;
  onRowClick: (e: React.MouseEvent<HTMLDivElement>, task: GanttTask, el: HTMLDivElement) => void;
  onDragStart: (e: React.MouseEvent, kind: 'move-task' | 'resize-left' | 'resize-right') => void;
  onBarClick: (e: React.MouseEvent) => void;
  today: string;
}) {
  const rowRef     = useRef<HTMLDivElement>(null);
  const isUnplaced = !task.startDate || !task.endDate;
  return (
    <div
      ref={rowRef}
      style={{ height: rowH, width: totalWidth, position: 'relative', background: isHovered ? 'var(--bg-row-hover)' : 'var(--bg-surface)', borderBottom: '1px solid var(--border)', cursor: isUnplaced ? 'crosshair' : 'default', transition: 'background 0.1s', display: 'flex' }}
      onMouseEnter={() => onHover(task.id)}
      onMouseLeave={() => onHover(null)}
      onClick={e => { if (rowRef.current) onRowClick(e, task, rowRef.current); }}
    >
      {columns.map((col, i) => (
        <div key={i} style={{ width: colWidth, height: '100%', flexShrink: 0, borderRight: '1px solid var(--border)', background: formatDate(col) === today ? 'var(--accent-light)' : (isWeekend(col) && colWidth < 50 ? '#f9fafb' : 'transparent') }} />
      ))}
      {isUnplaced && isHovered && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 12, pointerEvents: 'none', zIndex: 2 }}>
          <span style={{ fontSize: 11, color: project.color, fontStyle: 'italic', background: project.color + '12', padding: '2px 8px', borderRadius: 4, border: `1px dashed ${project.color}60` }}>
            {isHalf ? '→ Click to set end date' : '→ Click to set start date'}
          </span>
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, zIndex: 3 }}>
        <TaskBar task={task} color={task.color ?? project.color} calStart={calStartDate} ppd={ppd} rowH={rowH} preview={preview} onDragStart={onDragStart} onBarClick={onBarClick} />
      </div>
    </div>
  );
}

// ─── Calendar: Milestones Row ─────────────────────────────────────────────────

function CalendarMilestonesRow({ milestones, project, rowH, totalWidth, calStartDate, ppd, columns, colWidth, isHovered, onHover, onRowClick, onMilestoneDragStart, onMilestoneLabelClick, milestoneRow, dragPreview, today }: {
  milestones: GanttMilestone[]; project: Project; rowH: number; totalWidth: number; calStartDate: Date; ppd: number;
  columns: Date[]; colWidth: number; isHovered: boolean; onHover: (key: string | null) => void;
  onRowClick: (e: React.MouseEvent<HTMLDivElement>, milestones: GanttMilestone[], el: HTMLDivElement) => void;
  onMilestoneDragStart: (e: React.MouseEvent, milestone: GanttMilestone) => void;
  onMilestoneLabelClick: (e: React.MouseEvent, milestone: GanttMilestone) => void;
  milestoneRow?: MilestoneRow;
  dragPreview: CalDragPreview | null; today: string;
}) {
  const rowRef        = useRef<HTMLDivElement>(null);
  const hoverKey      = `ms-${project.id}`;
  const hasUnplaced   = milestones.some(m => m.date === null);
  const firstUnplaced = milestones.find(m => m.date === null);
  return (
    <div
      ref={rowRef}
      style={{ height: rowH, width: totalWidth, position: 'relative', background: isHovered ? 'var(--bg-row-hover)' : 'var(--bg-surface)', borderBottom: '1px solid var(--border)', cursor: hasUnplaced ? 'crosshair' : 'default', transition: 'background 0.1s', display: 'flex' }}
      onMouseEnter={() => onHover(hoverKey)}
      onMouseLeave={() => onHover(null)}
      onClick={e => { if (rowRef.current) onRowClick(e, milestones, rowRef.current); }}
    >
      {columns.map((col, i) => (
        <div key={i} style={{ width: colWidth, height: '100%', flexShrink: 0, borderRight: '1px solid var(--border)', background: formatDate(col) === today ? 'var(--accent-light)' : (isWeekend(col) && colWidth < 50 ? '#f9fafb' : 'transparent') }} />
      ))}
      {hasUnplaced && isHovered && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 12, pointerEvents: 'none', zIndex: 2 }}>
          <span style={{ fontSize: 11, color: project.color, fontStyle: 'italic', background: project.color + '12', padding: '2px 8px', borderRadius: 4, border: `1px dashed ${project.color}60` }}>
            🔷 Click to place "{firstUnplaced?.name}"
          </span>
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, zIndex: 3 }}>
        {milestones.filter(m => m.date !== null).map(m => (
          <MilestoneWithLabel
            key={m.id} milestone={m} color={m.color ?? project.color} calStart={calStartDate} ppd={ppd}
            previewDate={dragPreview?.itemId === m.id ? dragPreview.date : undefined}
            onDragStart={e => onMilestoneDragStart(e, m)}
            onLabelClick={e => onMilestoneLabelClick(e, m)}
            icon={milestoneRow?.icon}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────
// Floats near the clicked item. Saves description to Firestore on close.

// Swatches available in the color picker inside the detail panel
const ITEM_COLORS = [
  null, // null = use project color (default)
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6',
  '#3b82f6','#8b5cf6','#ec4899','#6b7280','#1e293b',
];

export function DetailPanel({ item, color, projectColor, anchorRect, onClose, onSave, onSaveColor, onSaveName }: {
  item: GanttTask | GanttMilestone;
  color: string;
  projectColor: string;
  anchorRect: DOMRect;
  onClose: () => void;
  onSave: (description: string) => void;
  onSaveColor: (color: string | null) => void;
  onSaveName: (name: string) => void;
}) {
  const [desc, setDesc]               = useState(item.description ?? '');
  const [name, setName]               = useState(item.name);
  const [activeColor, setActiveColor] = useState<string | null>(item.color ?? null);
  const panelRef = useRef<HTMLDivElement>(null);

  const PANEL_W = 420;
  const PANEL_H = 380;
  const initLeft = Math.max(8, Math.min(anchorRect.left + 12, window.innerWidth  - PANEL_W - 16));
  const initTop  = Math.max(8, Math.min(
    anchorRect.top + PANEL_H > window.innerHeight ? anchorRect.top - PANEL_H - 8 : anchorRect.top + 12,
    window.innerHeight - PANEL_H - 8
  ));

  // ── Drag-to-move state ────────────────────────────────────────────────────
  const [pos, setPos] = useState({ x: initLeft, y: initTop });
  const dragOrigin    = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  function onHeaderMouseDown(e: React.MouseEvent) {
    // Don't start drag on buttons inside the header
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragOrigin.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    function onMouseMove(ev: MouseEvent) {
      if (!dragOrigin.current) return;
      const newX = dragOrigin.current.px + ev.clientX - dragOrigin.current.mx;
      const newY = dragOrigin.current.py + ev.clientY - dragOrigin.current.my;
      // Clamp to viewport
      setPos({
        x: Math.max(0, Math.min(newX, window.innerWidth  - PANEL_W)),
        y: Math.max(0, Math.min(newY, window.innerHeight - 60)),
      });
    }
    function onMouseUp() {
      dragOrigin.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // Close on outside click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onSave(desc);
        onSaveColor(activeColor);
        onSaveName(name.trim() || item.name);
        onClose();
      }
    }
    const t = setTimeout(() => document.addEventListener('pointerdown', onPointerDown), 0);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', onPointerDown); };
  }, [desc, onClose, onSave]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onSave(desc); onSaveColor(activeColor); onSaveName(name.trim() || item.name); onClose(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [desc, onClose, onSave]);

  const isMilestone = item.type === 'milestone';
  const dateLabel   = isMilestone
    ? ((item as GanttMilestone).date ?? 'unplaced')
    : `${(item as GanttTask).startDate ?? '?'} → ${(item as GanttTask).endDate ?? '?'}`;

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: PANEL_W,
        background: 'var(--bg-surface)',
        border: `1.5px solid ${color}`,
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        zIndex: 1000,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Header — drag handle (grip area excludes the input) */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div onMouseDown={onHeaderMouseDown} style={{ cursor: 'grab', marginTop: 6, flexShrink: 0 }}>
          <div style={{ width: 10, height: 10, borderRadius: isMilestone ? 2 : 3, background: activeColor ?? projectColor, transform: isMilestone ? 'rotate(45deg)' : 'none' }} />
        </div>
        <div style={{ flex: 1 }}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(item.name); e.currentTarget.blur(); } }}
            style={{
              fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.3,
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              borderBottom: '1.5px solid transparent', borderRadius: 0, padding: '0 0 1px 0',
              fontFamily: 'inherit',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.target.style.borderBottomColor = activeColor ?? projectColor)}
            onBlur={e => { e.target.style.borderBottomColor = 'transparent'; if (name.trim()) onSaveName(name.trim()); }}
          />
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{dateLabel}</div>
        </div>
        <button
          onClick={() => { onSave(desc); onSaveColor(activeColor); onSaveName(name.trim() || item.name); onClose(); }}
          style={{ width: 20, height: 20, borderRadius: 4, background: 'var(--bg-header)', color: 'var(--text-secondary)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >×</button>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* Color picker */}
      <div>
        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>
          Color
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ITEM_COLORS.map((c, i) => {
            const swatchColor = c ?? projectColor;
            const isSelected  = c === activeColor;
            return (
              <button
                key={i}
                title={c === null ? 'Use project color (default)' : c}
                onClick={() => setActiveColor(c)}
                style={{
                  width: 22, height: 22, borderRadius: 5,
                  background: swatchColor,
                  border: isSelected ? '2.5px solid var(--text-primary)' : '2px solid transparent',
                  boxShadow: isSelected ? '0 0 0 1px #fff inset' : 'none',
                  position: 'relative', flexShrink: 0,
                  transition: 'transform 0.1s',
                  transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                }}
              >
                {/* "Default" swatch gets a small reset indicator */}
                {c === null && (
                  <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 700, textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>↺</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Description */}
      <div>
        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
          Description
        </label>
        <textarea
          autoFocus
          value={desc}
          onChange={e => setDesc(e.target.value)}
          placeholder="Add notes, context, or details…"
          style={{
            width: '100%',
            height: 280,
            resize: 'vertical',
            fontSize: 12,
            color: 'var(--text-primary)',
            background: 'var(--bg-app)',
            border: '1.5px solid var(--border)',
            borderRadius: 6,
            padding: '7px 9px',
            lineHeight: 1.5,
            outline: 'none',
            boxSizing: 'border-box',
            fontFamily: 'inherit',
          }}
          onFocus={e => (e.target.style.borderColor = activeColor ?? projectColor)}
          onBlur={e => (e.target.style.borderColor = 'var(--border)')}
        />
      </div>

      {/* Save button */}
      <button
        onClick={() => { onSave(desc); onSaveColor(activeColor); onSaveName(name.trim() || item.name); onClose(); }}
        style={{
          background: activeColor ?? projectColor,
          color: '#fff',
          borderRadius: 6,
          padding: '6px 0',
          fontSize: 12,
          fontWeight: 700,
          width: '100%',
          transition: 'background 0.15s',
        }}
      >
        Save
      </button>
    </div>
  );
}

// ─── Context Menu Item ───────────────────────────────────────────────────────

function CtxMenuItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '7px 12px', borderRadius: 6, textAlign: 'left',
        fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
        color: 'var(--text-primary)', background: 'transparent', transition: 'background 0.1s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-row-hover)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ fontSize: 12, width: 16, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  );
}

// ─── Left Panel: Subgroup Header Row ─────────────────────────────────────────

const LeftPanelSubgroupHeader = React.forwardRef<HTMLDivElement, {
  subgroup: Subgroup;
  project: Project;
  rowH: number;
  isDragOver?: boolean;
  onToggle: () => void;
  onDelete: () => void;
}>(({ subgroup, project, rowH, isDragOver, onToggle, onDelete }, ref) => {
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div
      ref={ref}
      style={{
        height: rowH,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 20,
        paddingRight: 8,
        gap: 6,
        background: isDragOver ? project.color + '30' : project.color + '14',
        borderBottom: '1px solid var(--border)',
        borderLeft: `3px solid ${project.color}${isDragOver ? 'cc' : '60'}`,
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background 0.1s',
      }}
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
      onClick={onToggle}
    >
      {/* Collapse arrow */}
      <span style={{
        fontSize: 8, color: project.color,
        transform: subgroup.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
        transition: 'transform 0.15s', display: 'inline-block', flexShrink: 0,
      }}>▼</span>

      {/* Subgroup icon */}
      <span style={{ fontSize: 11, color: project.color, flexShrink: 0 }}>▤</span>

      {/* Name */}
      <span style={{
        flex: 1, fontWeight: 600, fontSize: 11,
        color: 'var(--text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {subgroup.name}
      </span>

      {showDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          title="Delete subgroup (items move to top-level)"
          style={{
            width: 18, height: 18, borderRadius: 4,
            background: '#fee2e2', color: '#ef4444',
            fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >×</button>
      )}
    </div>
  );
});
LeftPanelSubgroupHeader.displayName = 'LeftPanelSubgroupHeader';

// ─── Calendar: Subgroup Header Row ────────────────────────────────────────────

function CalendarSubgroupRow({ subgroup, project, totalWidth, rowH, columns, colWidth }: {
  subgroup: Subgroup;
  project: Project;
  totalWidth: number;
  rowH: number;
  columns: Date[];
  colWidth: number;
}) {
  return (
    <div style={{
      height: rowH,
      width: totalWidth,
      background: project.color + '14',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      position: 'relative',
    }}>
      {columns.map((col, i) => (
        <div key={i} style={{
          width: colWidth, height: '100%', flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: isWeekend(col) && colWidth < 50 ? '#f9fafb' : 'transparent',
        }} />
      ))}
      {/* Subtle subgroup label in the calendar */}
      <div style={{
        position: 'absolute', left: 8, top: 0, bottom: 0,
        display: 'flex', alignItems: 'center',
        pointerEvents: 'none', zIndex: 2,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 600,
          color: project.color, opacity: 0.6,
          whiteSpace: 'nowrap',
        }}>
          {subgroup.name}
        </span>
      </div>
    </div>
  );
}

// ─── Left Panel: Task Row Group ───────────────────────────────────────────────

function LeftPanelTaskRowGroup({ row, rowH, isHovered, onHover, onDeleteTask, onDeleteRow }: {
  row: CalendarRow & { kind: 'taskrow' };
  rowH: number;
  isHovered: boolean;
  onHover: (key: string | null) => void;
  onDeleteTask: (id: string) => void;
  onDeleteRow: () => void;
}) {
  const { tasks, project, taskRow } = row;
  const key = `tr-${taskRow.id}`;

  return (
    <div
      style={{ height: rowH, display: 'flex', alignItems: 'center', paddingLeft: 28, paddingRight: 8, gap: 6,
        background: isHovered ? 'var(--bg-row-hover)' : 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)', transition: 'background 0.1s', position: 'relative' }}
      onMouseEnter={() => onHover(key)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Row icon */}
      <div style={{ width: 12, height: 5, background: project.color, borderRadius: 2, flexShrink: 0, opacity: 0.5 }} />

      {/* Row name */}
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', flex: 1,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {taskRow.name}
      </span>

      {/* Task count */}
      <span style={{ fontSize: 10, fontWeight: 600, color: project.color,
        background: project.color + '18', borderRadius: 10, padding: '1px 6px', flexShrink: 0 }}>
        {tasks.length}
      </span>

      {/* Delete row */}
      {isHovered && (
        <button onClick={() => { if (window.confirm('Delete task row? Tasks move to independent rows.')) onDeleteRow(); }}
          style={{ width: 16, height: 16, borderRadius: 3, background: '#fee2e2', color: '#ef4444', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
      )}

      {/* Tooltip — appears BELOW the row, inside the left panel, so it never overlays the calendar */}
      {isHovered && tasks.length > 0 && (
        <div style={{
          position: 'absolute', left: 0, top: '100%', zIndex: 50, width: '100%',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderTop: 'none', borderRadius: '0 0 8px 8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          padding: '4px 0',
        }}>
          {tasks.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px' }}>
              <div style={{ width: 10, height: 4, background: t.color ?? project.color, borderRadius: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{t.name}</span>
              <button onClick={() => onDeleteTask(t.id)}
                style={{ width: 14, height: 14, borderRadius: 3, background: '#fee2e2', color: '#ef4444', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Calendar: Task Row Group ─────────────────────────────────────────────────
// Renders multiple task bars stacked vertically within a single ROW_H row

function CalendarTaskRowGroup({ tasks, taskRow, project, rowH, totalWidth, calStartDate, ppd, columns, colWidth, isHovered, onHover, onBarClick, onRowClick, onDragStart, dragPreview, today }: {
  tasks: GanttTask[]; taskRow: TaskRow; project: Project;
  rowH: number; totalWidth: number; calStartDate: Date; ppd: number;
  columns: Date[]; colWidth: number; isHovered: boolean;
  onHover: (key: string | null) => void;
  onBarClick: (e: React.MouseEvent, task: GanttTask) => void;
  onRowClick: (e: React.MouseEvent<HTMLDivElement>, task: GanttTask, el: HTMLDivElement) => void;
  onDragStart: (e: React.MouseEvent, kind: 'move-task' | 'resize-left' | 'resize-right', task: GanttTask) => void;
  dragPreview: CalDragPreview | null;
  today: string;
}) {
  const key    = `tr-${taskRow.id}`;
  const rowRef = useRef<HTMLDivElement>(null);
  // All bars at same height — parallel in the same lane, may overlap
  const BAR_H = TASK_BAR_H;

  // First unplaced task — the one that will be placed on next click
  const firstUnplaced = tasks.find(t => !t.startDate || !t.endDate);
  const hasUnplaced   = !!firstUnplaced;

  return (
    <div
      ref={rowRef}
      style={{ height: rowH, width: totalWidth, position: 'relative',
        background: isHovered ? 'var(--bg-row-hover)' : 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)', display: 'flex', transition: 'background 0.1s',
        cursor: hasUnplaced ? 'crosshair' : 'default' }}
      onMouseEnter={() => onHover(key)}
      onMouseLeave={() => onHover(null)}
      onClick={e => { if (firstUnplaced && rowRef.current) onRowClick(e, firstUnplaced, rowRef.current); }}
    >
      {/* Column background */}
      {columns.map((col, i) => (
        <div key={i} style={{ width: colWidth, height: '100%', flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: formatDate(col) === today ? 'var(--accent-light)' : (isWeekend(col) && colWidth < 50 ? '#f9fafb' : 'transparent') }} />
      ))}

      {/* Placement hint when there's an unplaced task */}
      {hasUnplaced && isHovered && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          paddingLeft: 12, pointerEvents: 'none', zIndex: 2 }}>
          <span style={{ fontSize: 11, color: project.color, fontStyle: 'italic',
            background: project.color + '12', padding: '2px 8px', borderRadius: 4,
            border: `1px dashed ${project.color}60` }}>
            {firstUnplaced?.startDate ? '→ Click to set end date' : `→ Click to place "${firstUnplaced?.name}"`}
          </span>
        </div>
      )}

      {/* Task bars — reuse TaskBar which has drag handles built in */}
      {/* Detect overlaps: if a task's date range intersects another's, render both semi-transparent */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 3 }}>
        {tasks.map(t => {
          // A task overlaps if any other placed task in the row shares a date range with it
          const isOverlapping = t.startDate && t.endDate && tasks.some(other =>
            other.id !== t.id &&
            other.startDate && other.endDate &&
            t.startDate! <= other.endDate! &&
            t.endDate! >= other.startDate!
          );
          const taskPreview = dragPreview?.itemId === t.id
            ? { startDate: dragPreview.startDate, endDate: dragPreview.endDate }
            : undefined;
          return (
            <div key={t.id}
              style={{ opacity: isOverlapping ? 0.65 : 1, transition: 'opacity 0.15s' }}
              onClick={t.startDate && t.endDate ? e => e.stopPropagation() : undefined}
            >
              <TaskBar
                task={t}
                color={t.color ?? project.color}
                calStart={calStartDate}
                ppd={ppd}
                rowH={rowH}
                preview={taskPreview}
                onDragStart={(e, kind) => onDragStart(e, kind, t)}
                onBarClick={e => { e.stopPropagation(); onBarClick(e, t); }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
