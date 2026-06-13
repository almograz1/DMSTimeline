import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { useGantt } from '../context/GanttContext';
import { useTimeline } from '../auth/TimelineContext';
import type { CalendarRow, GanttTask, GanttMilestone, Project, Subgroup, MilestoneRow, TaskRow } from '../types';
import {
  parseDate, formatDate, addDays, dayDiff,
  buildDailyColumns, buildWeeklyColumns, buildMonthlyColumns, daysInMonth,
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
const MONTHLY_COL_W    = 160;
const TASK_BAR_H       = 22;
const MILESTONE_SZ     = 14;
const MILESTONE_NAME_H = 16;
const LABEL_W          = 90;
const HANDLE_W         = 6;
const MS_NAME_LINE     = 12; // vertical height of one stacked milestone-name tier

function pxPerDay(viewMode: 'daily' | 'weekly' | 'monthly'): number {
  if (viewMode === 'daily')   return DAILY_COL_W;
  if (viewMode === 'monthly') return MONTHLY_COL_W / 30.44; // approx px per day
  return WEEKLY_COL_W / 7;
}

// ─── Hover tooltip ────────────────────────────────────────────────────────────

/** Human-friendly date, e.g. "Mon 15 Jun 2026" */
function prettyDate(iso: string): string {
  const d = parseDate(iso);
  return `${getDayName(d)} ${d.getDate()} ${getMonthName(d)} ${d.getFullYear()}`;
}

/** Callback a bar/milestone fires to request the floating tooltip */
type ItemHoverFn = (item: GanttTask | GanttMilestone, color: string, e: React.MouseEvent) => void;

interface TooltipState { item: GanttTask | GanttMilestone; color: string; x: number; y: number }

/** Floating, richly-formatted hover card rendered above everything (fixed position). */
function HoverTooltip({ tip }: { tip: TooltipState }) {
  const { item, color } = tip;
  // Keep the card on-screen: flip to the left/up when near the viewport edge.
  const W = 260;
  const left = Math.min(tip.x + 16, window.innerWidth - W - 12);
  const top  = Math.min(tip.y + 18, window.innerHeight - 140);

  let dateLine: React.ReactNode;
  if (item.type === 'milestone') {
    dateLine = item.date
      ? <span>{prettyDate(item.date)}</span>
      : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not scheduled</span>;
  } else {
    if (item.startDate && item.endDate) {
      const days = dayDiff(parseDate(item.startDate), parseDate(item.endDate)) + 1;
      dateLine = (
        <span>
          {prettyDate(item.startDate)} <span style={{ color: 'var(--text-muted)' }}>→</span> {prettyDate(item.endDate)}
          <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>· {days} day{days === 1 ? '' : 's'}</span>
        </span>
      );
    } else if (item.startDate) {
      dateLine = <span>Starts {prettyDate(item.startDate)} <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>· end not set</span></span>;
    } else {
      dateLine = <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not scheduled</span>;
    }
  }

  return (
    <div style={{
      position: 'fixed', left, top, width: W, zIndex: 400, pointerEvents: 'none',
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderLeft: `3px solid ${color}`,
      borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)',
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 11, flexShrink: 0 }}>{item.type === 'milestone' ? '◆' : '▬'}</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.name?.trim() || 'Untitled'}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
        {dateLine}
      </div>
      {item.description?.trim() && (
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5, borderTop: '1px solid var(--border)', paddingTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflow: 'hidden' }}>
          {item.description.trim()}
        </div>
      )}
    </div>
  );
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
  kind: 'project' | 'task' | 'taskrow' | 'milestonerow';
  id: string;
  projectId?: string;
  subgroupId?: string | null;
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
  onItemHover?: (e: React.MouseEvent) => void;
  onItemLeave?: () => void;
}

function TaskBar({ task, color, calStart, ppd, rowH, preview, onDragStart, onBarClick, onItemHover, onItemLeave }: TaskBarProps) {
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
      }}
      onMouseEnter={onItemHover} onMouseMove={onItemHover} onMouseLeave={onItemLeave}>
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
      onMouseEnter={onItemHover} onMouseMove={onItemHover} onMouseLeave={onItemLeave}
      onMouseDown={e => { e.stopPropagation(); onItemLeave?.(); onDragStart(e, 'move-task'); }}
      onClick={e => { e.stopPropagation(); onBarClick?.(e); }}
    >
      <div
        style={{ position: 'absolute', left: 0, top: 0, width: HANDLE_W, height: '100%', cursor: 'ew-resize', background: 'rgba(0,0,0,0.15)', borderRadius: '5px 0 0 5px', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseDown={e => { e.stopPropagation(); onDragStart(e, 'resize-left'); }}
      >
        <div style={{ width: 1.5, height: 10, background: 'rgba(255,255,255,0.5)', borderRadius: 1 }} />
      </div>
      <span style={{ flex: 1, paddingLeft: HANDLE_W + 4, paddingRight: HANDLE_W + 4, color: '#fff', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 1px 3px rgba(0,0,0,0.4)', pointerEvents: 'none', textAlign: 'center' }}>
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

// ─── Milestone label layout (collision-aware staggering) ─────────────────────
// When milestone labels (LABEL_W wide, centered on their date) would overlap, we
// stack the colliding ones onto separate vertical tiers so names stay readable.
// Returns the tier index per milestone id and the total row height it requires.
function milestoneLayout(
  milestones: GanttMilestone[], ppd: number, calStart: Date,
): { tierOf: Record<string, number>; height: number } {
  const placed = milestones
    .filter(m => m.date)
    .map(m => ({ id: m.id, center: dayDiff(calStart, parseDate(m.date!)) * ppd + ppd / 2 }))
    .sort((a, b) => a.center - b.center);

  const GAP = 6;
  const tierRight: number[] = []; // right edge currently occupied in each tier
  const tierOf: Record<string, number> = {};
  for (const p of placed) {
    const left  = p.center - LABEL_W / 2;
    const right = p.center + LABEL_W / 2;
    let t = 0;
    while (t < tierRight.length && tierRight[t] > left - GAP) t++; // first tier with room
    tierOf[p.id]  = t;
    tierRight[t]  = right;
  }
  const maxTier = tierRight.length > 0 ? tierRight.length - 1 : 0;
  return { tierOf, height: MILESTONE_ROW_H + maxTier * MS_NAME_LINE };
}

// ─── Sub-component: Milestone With Label ──────────────────────────────────────

function MilestoneWithLabel({ milestone, color, calStart, ppd, previewDate, onDragStart, onLabelClick, icon, onItemHover, onItemLeave, tier = 0, rowHeight = MILESTONE_ROW_H }: {
  milestone: GanttMilestone; color: string; calStart: Date; ppd: number;
  previewDate?: string | null; onDragStart: (e: React.MouseEvent) => void;
  onLabelClick?: (e: React.MouseEvent) => void;
  icon?: string; // custom icon from milestone row; defaults to diamond shape
  onItemHover?: (e: React.MouseEvent) => void;
  onItemLeave?: () => void;
  tier?: number;       // vertical stagger tier (0 = nearest the diamond)
  rowHeight?: number;  // full height of the milestone row (grows with tier count)
}) {
  const date = previewDate !== undefined ? previewDate : milestone.date;
  if (!date) return null;
  const centerX = dayDiff(calStart, parseDate(date)) * ppd + ppd / 2;
  // If icon is a non-diamond emoji/char, render it as text; otherwise render the rotated diamond div
  const isEmoji = icon && icon !== '◆';

  // Diamonds sit on a common line near the bottom; names fan upward by tier so
  // labels that would collide horizontally stack onto separate rows instead.
  const BOTTOM_PAD = 8;
  const diamondTop = rowHeight - BOTTOM_PAD - MILESTONE_SZ;
  const nameTop    = diamondTop - 2 - (tier + 1) * MS_NAME_LINE;
  const connectorTop = nameTop + MS_NAME_LINE;
  const connectorH   = Math.max(0, diamondTop - connectorTop);

  return (
    <div
      style={{ position: 'absolute', left: centerX - LABEL_W / 2, top: 0, width: LABEL_W, height: rowHeight, cursor: 'grab', userSelect: 'none' }}
      onMouseEnter={onItemHover} onMouseMove={onItemHover} onMouseLeave={onItemLeave}
      onMouseDown={e => { e.stopPropagation(); onItemLeave?.(); onDragStart(e); }}
      onClick={e => { e.stopPropagation(); onLabelClick?.(e); }}
    >
      <span style={{ position: 'absolute', left: 0, top: nameTop, width: LABEL_W, height: MS_NAME_LINE, fontSize: 10, fontWeight: 700, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: `${MS_NAME_LINE}px`, textAlign: 'center', textShadow: '0 0 4px #fff, 0 0 4px #fff', pointerEvents: 'none' }}>
        {milestone.name}
      </span>
      <div style={{ position: 'absolute', left: LABEL_W / 2 - 0.5, top: connectorTop, width: 1, height: connectorH, background: color + '80', pointerEvents: 'none' }} />
      {isEmoji ? (
        <span style={{ position: 'absolute', left: LABEL_W / 2 - (MILESTONE_SZ + 2) / 2, top: diamondTop - 1, fontSize: MILESTONE_SZ + 2, lineHeight: 1, pointerEvents: 'none', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.2))' }}>{icon}</span>
      ) : (
        <div style={{ position: 'absolute', left: LABEL_W / 2 - MILESTONE_SZ / 2, top: diamondTop, width: MILESTONE_SZ, height: MILESTONE_SZ, background: color, transform: 'rotate(45deg)', borderRadius: 3, boxShadow: `0 2px 6px ${color}66`, pointerEvents: 'none' }} />
      )}
    </div>
  );
}

// ─── Calendar Header ──────────────────────────────────────────────────────────

function CalendarHeader({ columns, viewMode, colWidth, todayDate }: {
  columns: Date[]; viewMode: 'daily' | 'weekly' | 'monthly'; colWidth: number; todayDate: string;
}) {
  // For monthly view: top row = year, bottom row = month name
  // For weekly/daily: top row = month+year spans, bottom row = week/day
  if (viewMode === 'monthly') {
    const yearSpans: { label: string; count: number }[] = [];
    columns.forEach(col => {
      const label = String(col.getFullYear());
      if (yearSpans.length && yearSpans[yearSpans.length - 1].label === label) yearSpans[yearSpans.length - 1].count++;
      else yearSpans.push({ label, count: 1 });
    });
    const todayMonth = new Date().getMonth();
    const todayYear  = new Date().getFullYear();
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: HEADER_H, borderBottom: '1.5px solid var(--border-strong)', background: 'var(--bg-header)', position: 'sticky', top: 0, zIndex: 5 }}>
        <div style={{ display: 'flex', height: 24, borderBottom: '1px solid var(--border)' }}>
          {yearSpans.map(({ label, count }) => (
            <div key={label} style={{ width: count * colWidth, flexShrink: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, fontSize: 10.5, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.06em', textTransform: 'uppercase', borderRight: '1px solid var(--border)', overflow: 'hidden' }}>{label}</div>
          ))}
        </div>
        <div style={{ display: 'flex', flex: 1 }}>
          {columns.map((col, i) => {
            const isCurrentMonth = col.getMonth() === todayMonth && col.getFullYear() === todayYear;
            return (
              <div key={i} style={{ width: colWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--border)', fontSize: 11, fontWeight: isCurrentMonth ? 700 : 500, color: isCurrentMonth ? 'var(--accent)' : 'var(--text-primary)', background: isCurrentMonth ? 'var(--accent-light)' : 'transparent', overflow: 'hidden' }}>
                <span style={{ fontSize: 11, fontWeight: isCurrentMonth ? 700 : 500 }}>{getMonthName(col)}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

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
          <div key={label + count} style={{ width: count * colWidth, flexShrink: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, fontSize: 10.5, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.06em', textTransform: 'uppercase', borderRight: '1px solid var(--border)', overflow: 'hidden' }}>{label}</div>
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
  const { isViewOnly, activeTimeline } = useTimeline();
  const { projects, subgroups, items, vacations, milestoneRows, taskRows, viewMode, calendarStart, calendarDays } = state;

  // ── Zoom — must be declared before ppd/colWidth which depend on zoomScale ──
  const ZOOM_LEVELS  = [0.6, 0.8, 1.0, 1.2] as const;
  const ZOOM_LABELS  = ['60%', '80%', '100%', '120%'] as const;
  const [zoomIdx, setZoomIdx] = useState(2); // default = 100%
  const zoomScale = ZOOM_LEVELS[zoomIdx];

  const today        = formatDate(new Date());
  const calStartDate = parseDate(calendarStart);
  const ppd          = pxPerDay(viewMode) * zoomScale;
  const colWidth     = (viewMode === 'daily' ? DAILY_COL_W : viewMode === 'monthly' ? MONTHLY_COL_W : WEEKLY_COL_W) * zoomScale;
  const numCols      = viewMode === 'daily' ? calendarDays : viewMode === 'monthly' ? Math.ceil(calendarDays / 30) + 2 : Math.ceil(calendarDays / 7);

  // ── Calendar drag (move/resize bars) ─────────────────────────────────────────

  const calDragStateRef   = useRef<CalDragState | null>(null);
  const calDragPreviewRef = useRef<CalDragPreview | null>(null);
  // A drag ends with a stray browser `click` on the moved element; this flag tells
  // the click handlers to ignore that one click so dragging doesn't pop open the
  // detail panel (which would steal focus and swallow the user's Ctrl+Z undo).
  const suppressClickRef  = useRef(false);
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
      // A click event fires right after this mouseup — swallow it so we don't open
      // the detail panel (and steal focus from Ctrl+Z) just from moving an item.
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 60);
    }
    calDragStateRef.current   = null;
    calDragPreviewRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor     = '';
    document.removeEventListener('mousemove', handleCalMouseMove);
    document.removeEventListener('mouseup',   handleCalMouseUp);
  }, [dispatch, handleCalMouseMove]);

  const startCalDrag = useCallback((e: React.MouseEvent, kind: CalDragState['kind'], item: GanttTask | GanttMilestone) => {
    if (isViewOnly) return;
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
  const chartContentRef = useRef<HTMLDivElement>(null); // full-size content node for PDF export
  const rowDragStateRef                                     = useRef<RowDragState | null>(null);
  const rowsRef         = useRef<CalendarRow[]>([]);
  const [rowDragKind, setRowDragKind]                       = useState<RowDragState['kind'] | null>(null);
  const [rowDropTarget,   setRowDropTarget]   = useState<string | null>(null);
  const [rowDropPosition, setRowDropPosition] = useState<'before' | 'after'>('after');
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  /** Called from the grip handle's onMouseDown */
  const startRowDrag = useCallback((e: React.MouseEvent, dragState: RowDragState) => {
    e.preventDefault();
    e.stopPropagation();
    rowDragStateRef.current = dragState;
    setRowDragKind(dragState.kind);
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = 'grabbing';

    function onMouseMove(ev: MouseEvent) {
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
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor     = '';
      // NOTE: rowDragStateRef and rowDropTarget are cleared by commitReorder
      // which fires from its own mouseup listener registered in a useEffect.
      // Do NOT clear them here or commitReorder won't find them.
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
      if (!drag || !targetKey) return;
      // For taskrow, key has tr- prefix; for others compare directly
      const selfKey = drag.kind === "taskrow" ? "tr-" + drag.id : drag.id;
      if (targetKey === selfKey) return;

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
      } else if (drag.kind === 'milestonerow' || drag.kind === 'taskrow') {
        const rows = rowsRef.current;

        const getRowKey = (r: typeof rows[0]): string => {
          if (r.kind === 'header')     return r.project.id;
          if (r.kind === 'subheader')  return 'sg-' + r.subgroup.id;
          if (r.kind === 'item')       return r.item.id;
          if (r.kind === 'taskrow')    return 'tr-' + r.taskRow.id;
          if (r.kind === 'milestones') return 'ms-' + r.project.id + '-' + (r.subgroup?.id ?? 'top') + '-' + (r.milestoneRow?.id ?? 'default');
          return '';
        };

        const isMyKind = (r: typeof rows[0]): boolean =>
          drag.kind === 'taskrow'
            ? r.kind === 'taskrow' && r.taskRow.projectId === drag.projectId
            : r.kind === 'milestones' && !!r.milestoneRow && r.project.id === drag.projectId;

        const getId = (r: typeof rows[0]): string =>
          drag.kind === 'taskrow'
            ? (r as any).taskRow.id
            : (r as any).milestoneRow.id;

        // Get all same-kind rows in current visual order (flat list order = display order)
        const kindRows = rows.filter(isMyKind);
        if (kindRows.length < 1) return;

        const fromIdx = kindRows.findIndex(r => getId(r) === drag.id);
        if (fromIdx === -1) return;

        // Find the visual position of the drop target in the full rows list
        const flatTargetIdx = rows.findIndex(r => getRowKey(r) === targetKey);
        if (flatTargetIdx === -1) return;

        // Determine where in the same-kind list to insert:
        // Count how many same-kind rows appear before the drop position (after accounting for before/after)
        const insertBeforeFlatIdx = pos === 'before' ? flatTargetIdx : flatTargetIdx + 1;

        // Count same-kind rows that appear strictly before insertBeforeFlatIdx (excluding the dragged one)
        let insertBeforeKindIdx = 0;
        for (let i = 0; i < rows.length && i < insertBeforeFlatIdx; i++) {
          if (isMyKind(rows[i]) && getId(rows[i]) !== drag.id) {
            insertBeforeKindIdx++;
          }
        }

        // Build new id order: remove from current position, insert at new position
        const ids = kindRows.map(getId);
        ids.splice(fromIdx, 1); // remove
        ids.splice(insertBeforeKindIdx, 0, drag.id); // insert

        if (drag.kind === 'taskrow') {
          const sgId = drag.subgroupId ?? null;
          dispatch({ type: 'REORDER_TASK_ROWS', projectId: drag.projectId!, subgroupId: sgId, orderedIds: ids });
        } else {
          const sgId = drag.subgroupId ?? null;
          dispatch({ type: 'REORDER_MILESTONE_ROWS', projectId: drag.projectId!, subgroupId: sgId, orderedIds: ids });
        }
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

    function commitReorderAndCleanup() {
      commitReorder();
      // Clear drag state after committing
      rowDragStateRef.current = null;
      setRowDragKind(null);
      setRowDropTarget(null);
    }
    document.addEventListener('mouseup', commitReorderAndCleanup);
    return () => document.removeEventListener('mouseup', commitReorderAndCleanup);
  }, [projects, items, taskRows, dispatch]);

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

      // Task rows scoped to this project+subgroup context
      const contextTaskRows = taskRows.filter(r =>
        r.projectId === project.id && (r.subgroupId ?? null) === (subgroup?.id ?? null)
      );
      const validTaskRowIds = new Set(contextTaskRows.map(r => r.id));

      // Independent tasks: no taskRowId or stale taskRowId
      const independentTasks = allTasks.filter(t => !t.taskRowId || !validTaskRowIds.has(t.taskRowId));
      for (const task of independentTasks) result.push({ kind: 'item', item: task, project, subgroup });

      // Named task rows for this context
      for (const tRow of contextTaskRows) {
        const rowTasks = allTasks.filter(t => t.taskRowId === tRow.id)
          .sort((a,b) => (a.order??0)-(b.order??0)) as GanttTask[];
        result.push({ kind: 'taskrow', tasks: rowTasks, project, subgroup, taskRow: tRow });
      }

      // Milestone rows scoped to this project+subgroup context
      const contextMilestoneRows = milestoneRows.filter(r =>
        r.projectId === project.id && (r.subgroupId ?? null) === (subgroup?.id ?? null)
      );

      if (contextMilestoneRows.length === 0) {
        // No named rows defined → single default row
        if (milestones.length > 0) result.push({ kind: 'milestones', milestones, project, subgroup });
      } else {
        // One row per named milestone row — only show if it has milestones
        for (const mRow of contextMilestoneRows) {
          const rowMilestones = milestones.filter(m => m.milestoneRowId === mRow.id);
          if (rowMilestones.length > 0) {
            result.push({ kind: 'milestones', milestones: rowMilestones, project, subgroup, milestoneRow: mRow });
          }
        }
        // Fallback: milestones not assigned to any named row
        const validRowIds = new Set(contextMilestoneRows.map(r => r.id));
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

      // Project-level milestone rows — render FIRST (at top of project)
      const topMilestones = (items.filter(i => isTopLevel(i) && i.type === 'milestone') as GanttMilestone[])
        .sort((a,b) => (a.order??0)-(b.order??0));
      const projectMilestoneRows = milestoneRows.filter(r => r.projectId === project.id && (r.subgroupId ?? null) === null);
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

      // Task rows scoped to project level (subgroupId = null)
      const projectTaskRows = taskRows.filter(r => r.projectId === project.id && (r.subgroupId ?? null) === null);
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

      // Project-level task rows (subgroupId=null)
      for (const tRow of projectTaskRows) {
        const rowTasks = (items.filter(i =>
          i.projectId === project.id && i.type === 'task' && i.taskRowId === tRow.id
        ) as GanttTask[]).sort((a,b) => (a.order??0)-(b.order??0));
        result.push({ kind: 'taskrow', tasks: rowTasks, project, taskRow: tRow });
      }
    }
    return result;
  }, [projects, subgroups, items, milestoneRows, taskRows]);
  rowsRef.current = rows;

  const columns = useMemo(
    () => {
      if (viewMode === 'daily')   return buildDailyColumns(calStartDate, numCols);
      if (viewMode === 'monthly') return buildMonthlyColumns(calStartDate, numCols);
      return buildWeeklyColumns(calStartDate, numCols);
    },
    [calStartDate, viewMode, numCols]
  );

  const totalCalWidth = numCols * colWidth;

  // In monthly view, column headers start at the 1st of calStartDate's month (columns[0]),
  // not at calStartDate itself (which is a Monday, offset into the month).
  // All position calculations must use the same origin as the column headers.
  const calRefDate = viewMode === 'monthly' ? columns[0] : calStartDate;

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // ── Hover tooltip (rich card over a bar/milestone) ─────────────────────────────
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const showItemTip = useCallback<ItemHoverFn>((item, color, e) => {
    if (calDragStateRef.current) return; // suppress while dragging
    setTooltip({ item, color, x: e.clientX, y: e.clientY });
  }, []);
  const hideItemTip = useCallback(() => setTooltip(null), []);

  // ── PDF export ─────────────────────────────────────────────────────────────────
  // Rasterizes the full (non-scrolled) chart content at high DPI and drops it into a
  // single-page PDF sized to the content, so the whole timeline exports crisply.
  const [exporting, setExporting] = useState(false);
  const exportPDF = useCallback(async () => {
    const node = chartContentRef.current;
    if (!node || exporting) return;
    setExporting(true);
    setTooltip(null);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const fullW = node.scrollWidth;
      const fullH = node.scrollHeight;
      // Cap the largest dimension so we stay within browser canvas limits while
      // still rendering at >1× for a sharp result.
      const scale = Math.max(1, Math.min(2, 12000 / Math.max(fullW, fullH)));
      const canvas = await html2canvas(node, {
        backgroundColor: '#ffffff',
        scale,
        width: fullW, height: fullH,
        windowWidth: fullW, windowHeight: fullH,
        scrollX: 0, scrollY: 0,
      });
      const pdf = new jsPDF({
        orientation: fullW >= fullH ? 'landscape' : 'portrait',
        unit: 'px',
        format: [fullW, fullH],
        compress: true,
      });
      pdf.addImage(canvas, 'PNG', 0, 0, fullW, fullH, undefined, 'FAST');
      const safeName = (activeTimeline?.name || 'timeline').replace(/[^\w.-]+/g, '_');
      pdf.save(`${safeName}-${today}.pdf`);
    } catch (err) {
      console.error('[Export] PDF export failed:', err);
      window.alert('PDF export failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExporting(false);
    }
  }, [exporting, activeTimeline, today]);

  // ── Detail panel ──────────────────────────────────────────────────────────────
  const [detailPanel, setDetailPanel] = useState<{
    item: GanttTask | GanttMilestone;
    color: string;
    projectColor: string;
    anchorRect: DOMRect;
  } | null>(null);

  const openDetail = useCallback((item: GanttTask | GanttMilestone, projectColor: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Ignore the stray click that follows a drag-move/resize (see suppressClickRef).
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
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
      const rowHeight = row.kind === 'milestones' ? milestoneLayout(row.milestones, ppd, calRefDate).height : ROW_H;
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
  }, [rows, projects, ganttScrollRef, ppd, calRefDate]);

  /** Returns true if the given ISO date falls within any vacation period */
  const isVacationDate = useCallback((date: string): boolean => {
    return vacations.some(v => date >= v.startDate && date <= v.endDate);
  }, [vacations]);

  const saveDetail = useCallback((itemId: string, description: string) => {
    dispatch({ type: 'UPDATE_ITEM', itemId, patch: { description } });
  }, [dispatch]);

  const saveDetailColor = useCallback((itemId: string, color: string | null) => {
    // Save null explicitly — undefined is ignored by Firestore merge, null deletes the field
    dispatch({ type: 'UPDATE_ITEM', itemId, patch: { color: color ?? null } });
  }, [dispatch]);

  const saveDetailName = useCallback((itemId: string, name: string) => {
    if (name.trim()) dispatch({ type: 'UPDATE_ITEM', itemId, patch: { name: name.trim() } });
  }, [dispatch]);

  // ── Click handlers ────────────────────────────────────────────────────────────

  const handleTaskRowClick = useCallback((e: React.MouseEvent<HTMLDivElement>, task: GanttTask, rowEl: HTMLDivElement) => {
    if (isViewOnly || calDragStateRef.current || calDragPreviewRef.current) return;
    const dayOffset   = Math.floor((e.clientX - rowEl.getBoundingClientRect().left) / ppd);
    const clickedDate = formatDate(addDays(calRefDate, dayOffset));
    if (isVacationDate(clickedDate)) return; // blocked by vacation
    if (!task.startDate) {
      dispatch({ type: 'UPDATE_ITEM', itemId: task.id, patch: { startDate: clickedDate, endDate: null } });
    } else if (!task.endDate) {
      if (clickedDate >= task.startDate) dispatch({ type: 'UPDATE_ITEM', itemId: task.id, patch: { endDate: clickedDate } });
      else dispatch({ type: 'UPDATE_ITEM', itemId: task.id, patch: { startDate: clickedDate, endDate: null } });
    }
  }, [calRefDate, ppd, dispatch]);

  const handleMilestonesRowClick = useCallback((e: React.MouseEvent<HTMLDivElement>, milestones: GanttMilestone[], rowEl: HTMLDivElement) => {
    if (isViewOnly || calDragStateRef.current || calDragPreviewRef.current) return;
    const firstUnplaced = milestones.find(m => m.date === null);
    if (!firstUnplaced) return;
    const dayOffset   = Math.floor((e.clientX - rowEl.getBoundingClientRect().left) / ppd);
    const clickedDate = formatDate(addDays(calRefDate, dayOffset));
    if (isVacationDate(clickedDate)) return; // blocked by vacation
    dispatch({ type: 'UPDATE_ITEM', itemId: firstUnplaced.id, patch: { date: clickedDate } });
  }, [calRefDate, ppd, dispatch]);

  const todayOffset  = dayDiff(calRefDate, new Date()) * ppd;
  const todayVisible = todayOffset >= 0 && todayOffset <= totalCalWidth;
  const calDragPreview = calDragPreviewRef.current;
  void calDragTick;

  return (
    <>
    <div ref={ganttScrollRef} className='gantt-scroll' onContextMenu={e => e.preventDefault()} style={{ flex: 1, overflow: 'auto', display: 'flex', background: 'var(--bg-surface)' }}>
      <div ref={chartContentRef} style={{ display: 'flex', flexDirection: 'column', minWidth: LEFT_W + totalCalWidth, minHeight: '100%' }}>

        {/* ── SHARED HEADER ROW ─────────────────────────────────────────────
            The left-panel header and the calendar date header live in ONE flex
            row so the body columns below always share a single vertical origin.
            This keeps the left labels row-aligned with the calendar under any
            browser zoom (no per-column header rounding to drift apart). */}
        <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 15, flexShrink: 0 }}>
          <div style={{ width: LEFT_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2, height: HEADER_H, display: 'flex', alignItems: 'center', paddingLeft: 16, borderBottom: '1.5px solid var(--border-strong)', borderRight: '1.5px solid var(--border-strong)', background: 'var(--bg-header)' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Projects / Tasks</span>
          </div>
          <div
            onContextMenu={e => {
              e.preventDefault();
              if (isViewOnly) return;
              contextMenuFromCalendar.current = true;
              setQuickAdd(null);
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const dayOffset = Math.floor((e.clientX - rect.left) / ppd);
              const date = formatDate(addDays(calRefDate, dayOffset));
              const ctx = getRowContextFromY(e.clientY);
              setVacMenu({ x: e.clientX, y: e.clientY, date, ...ctx });
            }}
          >
            <CalendarHeader columns={columns} viewMode={viewMode} colWidth={colWidth} todayDate={today} />
          </div>
        </div>

        {/* ── BODY (left panel + calendar grid share one top origin) ── */}
        <div style={{ display: 'flex', flex: 1 }}>

        {/* ── LEFT PANEL ───────────────────────────────────────────────────── */}
        <div style={{ position: 'sticky', left: 0, width: LEFT_W, flexShrink: 0, background: 'var(--bg-surface)', borderRight: '1.5px solid var(--border-strong)', zIndex: 10, display: 'flex', flexDirection: 'column' }}>

          {rows.map((row, rowIndex) => {
            if (row.kind === 'header') {
              const key = row.project.id;
              const isProjectDrag = rowDragKind === 'project';
              const isTaskDragOnProject = rowDragKind === 'task' && rowDropTarget === row.project.id;
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
                    onDelete={isViewOnly ? undefined : () => dispatch({ type: 'DELETE_PROJECT', projectId: row.project.id })}
                    onGripMouseDown={isViewOnly ? undefined : e => startRowDrag(e, { kind: 'project', id: row.project.id })}
                    isDragOver={rowDropTarget === key || isTaskDragOnProject}
                  />
                  {showDropAfter && <DropIndicator color={row.project.color} />}
                </React.Fragment>
              );
            }

            if (row.kind === 'item') {
              const key       = row.item.id;
              const projectId = row.project.id;
              const isDragKindTask     = rowDragKind === 'task'        && rowDragStateRef.current?.projectId === projectId;
              const isDragKindTaskRow  = rowDragKind === 'taskrow'     && rowDragStateRef.current?.projectId === projectId;
              const isDragKindMsRow    = rowDragKind === 'milestonerow'&& rowDragStateRef.current?.projectId === projectId;
              const showDropBefore = rowDropTarget === key && rowDropPosition === 'before' && (isDragKindTask || isDragKindTaskRow || isDragKindMsRow);
              const showDropAfter  = rowDropTarget === key && rowDropPosition === 'after'  && (isDragKindTask || isDragKindTaskRow || isDragKindMsRow);
              return (
                <React.Fragment key={key}>
                  {showDropBefore && <DropIndicator color={row.project.color} />}
                  <LeftPanelTaskRow
                    ref={el => { if (el) rowRefs.current.set(key, el); else rowRefs.current.delete(key); }}
                    row={row} rowH={ROW_H}
                    isHovered={hoveredKey === key}
                    onHover={setHoveredKey}
                    onDelete={isViewOnly ? undefined : () => dispatch({ type: 'DELETE_ITEM', itemId: row.item.id })}
                    onGripMouseDown={isViewOnly ? undefined : e => startRowDrag(e, { kind: 'task', id: row.item.id, projectId: row.project.id, subgroupId: row.item.subgroupId ?? null })}
                  />
                  {showDropAfter && <DropIndicator color={row.project.color} />}
                </React.Fragment>
              );
            }

            if (row.kind === 'taskrow') {
              const key = `tr-${row.taskRow.id}`;
              const isTaskRowDrag = (rowDragKind === 'taskrow' || rowDragKind === 'milestonerow') && rowDragStateRef.current?.projectId === row.project.id;
              const showDropBefore = rowDropTarget === key && rowDropPosition === 'before' && isTaskRowDrag;
              const showDropAfter  = rowDropTarget === key && rowDropPosition === 'after'  && isTaskRowDrag;
              return (
                <React.Fragment key={key}>
                  {showDropBefore && <DropIndicator color={row.project.color} />}
                  <LeftPanelTaskRowGroup
                    ref={el => { if (el) rowRefs.current.set(key, el); else rowRefs.current.delete(key); }}
                    row={row}
                    rowH={ROW_H}
                    isHovered={hoveredKey === key}
                    onHover={setHoveredKey}
                    onUpdateColor={color => dispatch({ type: 'UPDATE_TASK_ROW', taskRowId: row.taskRow.id, patch: { color } })}
                    onRename={name => dispatch({ type: 'UPDATE_TASK_ROW', taskRowId: row.taskRow.id, patch: { name } })}
                    onDeleteTask={isViewOnly ? undefined : id => dispatch({ type: 'DELETE_ITEM', itemId: id })}
                    onDeleteRow={isViewOnly ? undefined : () => {
                      const rowTasks = items.filter(i => i.type === 'task' && i.taskRowId === row.taskRow.id);
                      const msg = rowTasks.length > 0
                        ? 'Delete task row ' + row.taskRow.name + ' and its ' + rowTasks.length + ' task' + (rowTasks.length === 1 ? '' : 's') + '? This cannot be undone.'
                        : 'Delete task row ' + row.taskRow.name + '?';
                      if (!window.confirm(msg)) return;
                      rowTasks.forEach(t => dispatch({ type: 'DELETE_ITEM', itemId: t.id }));
                      dispatch({ type: 'DELETE_TASK_ROW', taskRowId: row.taskRow.id });
                    }}
                    onGripMouseDown={isViewOnly ? undefined : e => startRowDrag(e, { kind: 'taskrow', id: row.taskRow.id, projectId: row.project.id, subgroupId: row.subgroup?.id ?? null })}
                  />
                  {showDropAfter && <DropIndicator color={row.project.color} />}
                </React.Fragment>
              );
            }

            if (row.kind === 'subheader') {
              const key = `sg-${row.subgroup.id}`;
              const isTaskDrag = rowDragKind === 'task';
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
                    onDelete={isViewOnly ? undefined : () => {
                      const sgItems = items.filter(i => i.subgroupId === row.subgroup.id);
                      if (sgItems.length > 0) {
                        const msg = 'Delete subgroup ' + row.subgroup.name + ' and its ' + sgItems.length + ' item' + (sgItems.length === 1 ? '' : 's') + '? This cannot be undone.';
                        if (!window.confirm(msg)) return;
                        sgItems.forEach(i => dispatch({ type: 'DELETE_ITEM', itemId: i.id }));
                      }
                      dispatch({ type: 'DELETE_SUBGROUP', subgroupId: row.subgroup.id });
                    }}
                  />
                  {showDropAfter && <DropIndicator color={row.project.color} />}
                </React.Fragment>
              );
            }

            {
              const rowKey = `ms-${row.project.id}-${row.subgroup?.id ?? 'top'}-${row.milestoneRow?.id ?? 'default'}`;
              const isMsRowDrag  = rowDragKind === 'milestonerow' && rowDragStateRef.current?.projectId === row.project.id;
              const isTrRowDrag  = rowDragKind === 'taskrow'      && rowDragStateRef.current?.projectId === row.project.id;
              const showDropBefore = rowDropTarget === rowKey && rowDropPosition === 'before' && (isMsRowDrag || isTrRowDrag);
              const showDropAfter  = rowDropTarget === rowKey && rowDropPosition === 'after'  && (isMsRowDrag || isTrRowDrag);
              return (
                <React.Fragment key={rowKey}>
                  {showDropBefore && <DropIndicator color={row.project.color} />}
                  <LeftPanelMilestonesRow
                    ref={row.milestoneRow ? (el => { if (el) rowRefs.current.set(rowKey, el); else rowRefs.current.delete(rowKey); }) : undefined}
                    row={row} rowH={milestoneLayout(row.milestones, ppd, calRefDate).height}
                    isHovered={hoveredKey === rowKey}
                    onHover={setHoveredKey}
                    onDeleteMilestone={isViewOnly ? undefined : id => dispatch({ type: 'DELETE_ITEM', itemId: id })}
                    onDeleteRow={!isViewOnly && row.milestoneRow ? () => {
                      const rowMilestones = items.filter(i => i.type === 'milestone' && i.milestoneRowId === row.milestoneRow!.id);
                      const msg = rowMilestones.length > 0
                        ? 'Delete milestone row ' + row.milestoneRow!.name + ' and its ' + rowMilestones.length + ' milestone' + (rowMilestones.length === 1 ? '' : 's') + '? This cannot be undone.'
                        : 'Delete milestone row ' + row.milestoneRow!.name + '?';
                      if (!window.confirm(msg)) return;
                      rowMilestones.forEach(m => dispatch({ type: 'DELETE_ITEM', itemId: m.id }));
                      dispatch({ type: 'DELETE_MILESTONE_ROW', milestoneRowId: row.milestoneRow!.id });
                    } : undefined}
                    onRename={!isViewOnly && row.milestoneRow ? name => dispatch({ type: 'UPDATE_MILESTONE_ROW', milestoneRowId: row.milestoneRow!.id, patch: { name } }) : undefined}
                    onGripMouseDown={!isViewOnly && row.milestoneRow ? e => startRowDrag(e, { kind: 'milestonerow', id: row.milestoneRow!.id, projectId: row.project.id, subgroupId: row.subgroup?.id ?? null }) : undefined}
                  />
                  {showDropAfter && <DropIndicator color={row.project.color} />}
                </React.Fragment>
              );
            }
          })}
        </div>

        {/* ── CALENDAR AREA ────────────────────────────────────────────────── */}
        <div
          style={{ flex: 1, position: 'relative' }}
          onContextMenu={e => {
            e.preventDefault();
            if (isViewOnly) return;
            contextMenuFromCalendar.current = true;
            setQuickAdd(null); // close any open quick-add form
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const dayOffset = Math.floor((e.clientX - rect.left) / ppd);
            const date = formatDate(addDays(calRefDate, dayOffset));
            const ctx = getRowContextFromY(e.clientY);
            setVacMenu({ x: e.clientX, y: e.clientY, date, ...ctx });
          }}
        >
            {todayVisible && (
              <div style={{ position: 'absolute', left: todayOffset, top: 0, bottom: 0, width: 2, background: 'var(--accent)', opacity: 0.5, zIndex: 3, pointerEvents: 'none' }} />
            )}

            {/* ── Vacation overlays ── */}
            {vacations.map(v => {
              const left  = dayDiff(calRefDate, parseDate(v.startDate)) * ppd;
              const right = dayDiff(calRefDate, parseDate(v.endDate))   * ppd + ppd;
              const width = right - left;
              if (width <= 0) return null;
              return (
                <div
                  key={v.id}
                  title={v.name + ': ' + v.startDate + ' to ' + v.endDate + (!isViewOnly ? ' (click to delete)' : '')}
                  onClick={isViewOnly ? undefined : () => { if (window.confirm('Delete vacation: ' + v.name)) dispatch({ type: 'DELETE_VACATION', vacationId: v.id }); }}
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
                return <CalendarSwimLaneRow key={row.project.id} project={row.project} totalWidth={totalCalWidth} rowH={ROW_H} columns={columns} colWidth={colWidth} />;
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
                    calStartDate={calRefDate} ppd={ppd}
                    columns={columns} colWidth={colWidth}
                    isHovered={hoveredKey === task.id}
                    isHalf={!!task.startDate && !task.endDate}
                    preview={preview}
                    subgroupTint={row.subgroup ? row.project.color + '12' : undefined}
                    isViewOnly={isViewOnly}
                    onHover={setHoveredKey}
                    onRowClick={handleTaskRowClick}
                    onDragStart={(e, kind) => startCalDrag(e, kind, task)}
                    onBarClick={isViewOnly ? undefined : e => openDetail(task, task.color ?? row.project.color, e)}
                    onItemHover={showItemTip}
                    onItemLeave={hideItemTip}
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
                    calStartDate={calRefDate}
                    ppd={ppd}
                    columns={columns}
                    colWidth={colWidth}
                    isHovered={hoveredKey === `tr-${row.taskRow.id}`}
                    subgroupTint={row.subgroup ? row.project.color + '12' : undefined}
                    onHover={setHoveredKey}
                    onBarClick={isViewOnly ? undefined : (e, task) => openDetail(task, task.color ?? row.project.color, e)}
                    onRowClick={handleTaskRowClick}
                    onDragStart={(e, kind, task) => startCalDrag(e, kind, task)}
                    dragPreview={calDragPreview}
                    onItemHover={showItemTip}
                    onItemLeave={hideItemTip}
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

              const msLayout = milestoneLayout(row.milestones, ppd, calRefDate);
              return (
                <CalendarMilestonesRow
                  key={`ms-${row.project.id}-${row.subgroup?.id ?? 'top'}-${row.milestoneRow?.id ?? 'default'}`}
                  milestones={row.milestones} project={row.project}
                  rowH={msLayout.height} totalWidth={totalCalWidth}
                  calStartDate={calRefDate} ppd={ppd}
                  columns={columns} colWidth={colWidth}
                  isHovered={hoveredKey === `ms-${row.project.id}-${row.subgroup?.id ?? 'top'}-${row.milestoneRow?.id ?? 'default'}`}
                  subgroupTint={row.subgroup ? row.project.color + '12' : undefined}
                  onHover={id => setHoveredKey(id)}
                  isViewOnly={isViewOnly}
                  onRowClick={handleMilestonesRowClick}
                  onMilestoneDragStart={(e, m) => startCalDrag(e, 'move-milestone', m)}
                  onMilestoneLabelClick={isViewOnly ? undefined : (e, m) => openDetail(m, m.color ?? row.project.color, e)}
                  milestoneRow={row.milestoneRow}
                  dragPreview={calDragPreview}
                  onItemHover={showItemTip}
                  onItemLeave={hideItemTip}
                  tierMap={msLayout.tierOf}
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
        onClick={exportPDF}
        disabled={exporting}
        title="Export this timeline to a high-quality PDF"
        style={{ height: 24, padding: '0 8px', borderRadius: 5, fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, opacity: exporting ? 0.5 : 1, cursor: exporting ? 'wait' : 'pointer' }}
      >
        {exporting ? '… Exporting' : '⬇ PDF'}
      </button>
      <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
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
          borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.08)',
          padding: 4, minWidth: 210,
        }}>
          {/* Date + project label */}
          <div style={{ padding: '6px 12px 8px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
            <div style={{ fontWeight: 500, letterSpacing: '0.02em' }}>📅 {vacMenu.date}</div>
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
            left: Math.min(quickAdd.x, window.innerWidth - 305),
            top: Math.min(quickAdd.y, window.innerHeight - 260),
            width: 290,
            background: 'var(--bg-surface)',
            border: '1.5px solid var(--accent)',
            borderRadius: 12,
            boxShadow: '0 12px 40px rgba(0,0,0,0.18), 0 3px 10px rgba(0,0,0,0.08)',
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

    {/* Rich hover tooltip — hidden while the detail panel is open to avoid overlap */}
    {tooltip && !detailPanel && <HoverTooltip tip={tooltip} />}
    </>
  );
}

// ─── Left Panel: Project Header ───────────────────────────────────────────────

const LeftPanelHeader = React.forwardRef<HTMLDivElement, {
  project: Project; rowH: number; onToggle: () => void; onDelete?: () => void;
  onGripMouseDown?: (e: React.MouseEvent) => void; isDragOver: boolean;
}>(({ project, rowH, onToggle, onDelete, onGripMouseDown, isDragOver }, ref) => {
  const [showDelete, setShowDelete] = useState(false);
  return (
    <div
      ref={ref}
      style={{
        height: rowH, display: 'flex', alignItems: 'center',
        paddingLeft: 4, paddingRight: 8, gap: 0,
        background: isDragOver ? project.color + '18' : 'var(--bg-swimlane)',
        borderBottom: '1px solid var(--border)',
        userSelect: 'none', transition: 'background 0.1s',
      }}
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
    >
      {onGripMouseDown && <GripHandle onMouseDown={onGripMouseDown} />}
      <span
        style={{ fontSize: 9, color: project.color, transform: project.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-block', flexShrink: 0, cursor: 'pointer', marginRight: 5 }}
        onClick={onToggle}
      >▼</span>
      <div style={{ width: 11, height: 11, borderRadius: 4, background: project.color, flexShrink: 0, boxShadow: '0 1px 3px ' + project.color + '66', marginRight: 7 }} />
      <span
        style={{ flex: 1, fontWeight: 700, fontSize: 12.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', letterSpacing: '-0.01em' }}
        onClick={onToggle}
      >{project.name}</span>
      {showDelete && onDelete && (
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
  isHovered: boolean; onHover: (id: string | null) => void; onDelete?: () => void;
  onGripMouseDown?: (e: React.MouseEvent) => void;
}>(({ row, rowH, isHovered, onHover, onDelete, onGripMouseDown }, ref) => {
  const { item, project } = row;
  const subgroupTint = row.subgroup ? project.color + '12' : undefined;
  return (
    <div
      ref={ref}
      style={{
        height: rowH, display: 'flex', alignItems: 'center',
        paddingLeft: 4, paddingRight: 8, gap: 0,
        background: isHovered ? 'var(--bg-row-hover)' : (subgroupTint ?? 'var(--bg-surface)'),
        borderBottom: '1px solid var(--border)', transition: 'background 0.1s',
        borderLeft: row.subgroup ? '3px solid ' + project.color + '50' : 'none',
        paddingLeft: row.subgroup ? 4 : 7,
      }}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
    >
      {onGripMouseDown && <GripHandle onMouseDown={onGripMouseDown} />}
      <div style={{ width: row.subgroup ? 24 : 20, flexShrink: 0 }} />
      <div style={{ width: 10, height: 10, background: (item as any).color ?? project.color, borderRadius: '50%', flexShrink: 0, marginRight: 7, boxShadow: '0 1px 3px ' + ((item as any).color ?? project.color) + '55' }} />
      <span style={{ flex: 1, fontSize: row.subgroup ? 11.5 : 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.name}
      </span>
      {isHovered && onDelete && (
        <button onClick={onDelete} style={{ width: 18, height: 18, borderRadius: 4, background: '#fee2e2', color: '#ef4444', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
      )}
    </div>
  );
});
LeftPanelTaskRow.displayName = 'LeftPanelTaskRow';

// ─── Left Panel: Milestones Row ───────────────────────────────────────────────

// ─── Inline Name Editor ──────────────────────────────────────────────────────

function InlineNameEditor({ name, onSave, style }: {
  name: string;
  onSave: (name: string) => void;
  style?: React.CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(name);
    setEditing(true);
    setTimeout(() => { inputRef.current?.select(); }, 0);
  }

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) onSave(trimmed);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') setEditing(false); }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        style={{
          flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--text-primary)',
          background: 'var(--bg-surface)', border: '1.5px solid var(--accent)',
          borderRadius: 4, padding: '1px 5px', outline: 'none',
          fontFamily: 'var(--font)', minWidth: 0,
          ...style,
        }}
        autoFocus
      />
    );
  }

  return (
    <span
      title="Double-click to rename"
      onDoubleClick={startEdit}
      style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default', ...style }}
    >
      {name}
    </span>
  );
}

const LeftPanelMilestonesRow = React.forwardRef<HTMLDivElement, {
  row: CalendarRow & { kind: 'milestones' }; rowH: number;
  isHovered: boolean; onHover: (key: string | null) => void;
  onDeleteMilestone: (id: string) => void;
  onDeleteRow?: () => void;
  onGripMouseDown?: (e: React.MouseEvent) => void;
  onRename?: (name: string) => void;
}>(({ row, rowH, isHovered, onHover, onDeleteMilestone, onDeleteRow, onGripMouseDown, onRename }, ref) => {
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
      ref={ref}
      style={{ height: rowH, display: 'flex', alignItems: 'center', paddingLeft: 4, paddingRight: 8, gap: 0, position: 'relative',
        background: isHovered ? 'var(--bg-row-hover)' : (row.subgroup ? row.project.color + '12' : 'var(--bg-surface)'),
        borderBottom: '1px solid var(--border)', transition: 'background 0.1s',
        borderLeft: row.subgroup ? '3px solid ' + row.project.color + '50' : 'none',
        paddingLeft: row.subgroup ? 4 : 7 }}
      onMouseEnter={() => { onHover(rowKey); setShowTooltip(true); }}
      onMouseLeave={() => { onHover(null); setShowTooltip(false); }}
    >
      {/* Grip handle — only for named milestone rows */}
      {onGripMouseDown ? <GripHandle onMouseDown={onGripMouseDown} /> : <div style={{ width: 18, flexShrink: 0 }} />}
      <div style={{ width: row.subgroup ? 24 : 20, flexShrink: 0 }} />{/* indent */}
      {/* Icon */}
      <span style={{ fontSize: 11, flexShrink: 0, marginRight: 6 }}>{icon}</span>

      {/* Label — double-click to rename */}
      <InlineNameEditor
        name={label}
        onSave={name => onRename?.(name)}
      />

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
});
LeftPanelMilestonesRow.displayName = 'LeftPanelMilestonesRow';

// ─── Calendar: Background Row ─────────────────────────────────────────────────

function CalendarSwimLaneRow({ totalWidth, rowH, columns, colWidth, project }: { totalWidth: number; rowH: number; columns: Date[]; colWidth: number; project: import('../types').Project }) {
  return (
    <div style={{ height: rowH, width: totalWidth, background: project.color + '08', borderBottom: '1px solid ' + project.color + '20', display: 'flex', position: 'relative' }}>
      {columns.map((col, i) => (
        <div key={i} style={{ width: colWidth, height: '100%', flexShrink: 0, borderRight: '1px solid var(--border)', background: isWeekend(col) && colWidth < 50 ? 'rgba(0,0,0,0.02)' : 'transparent' }} />
      ))}
      {/* Subtle project name watermark */}
      <div style={{ position: 'absolute', left: 10, top: 0, bottom: 0, display: 'flex', alignItems: 'center', pointerEvents: 'none', gap: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: 2, background: project.color, opacity: 0.5 }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: project.color, opacity: 0.4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{project.name}</span>
      </div>
    </div>
  );
}

// ─── Calendar: Task Row ───────────────────────────────────────────────────────

function CalendarTaskRow({ task, project, rowH, totalWidth, calStartDate, ppd, columns, colWidth, isHovered, isHalf, preview, subgroupTint, isViewOnly, onHover, onRowClick, onDragStart, onBarClick, onItemHover, onItemLeave, today }: {
  task: GanttTask; project: Project; rowH: number; totalWidth: number; calStartDate: Date; ppd: number;
  columns: Date[]; colWidth: number; isHovered: boolean; isHalf: boolean;
  preview?: { startDate: string | null; endDate: string | null };
  subgroupTint?: string; isViewOnly?: boolean;
  onHover: (id: string | null) => void;
  onRowClick: (e: React.MouseEvent<HTMLDivElement>, task: GanttTask, el: HTMLDivElement) => void;
  onDragStart: (e: React.MouseEvent, kind: 'move-task' | 'resize-left' | 'resize-right') => void;
  onBarClick?: (e: React.MouseEvent) => void;
  onItemHover: ItemHoverFn; onItemLeave: () => void;
  today: string;
}) {
  const rowRef     = useRef<HTMLDivElement>(null);
  const isUnplaced = !task.startDate || !task.endDate;
  const barColor   = task.color ?? project.color;
  return (
    <div
      ref={rowRef}
      style={{ height: rowH, width: totalWidth, position: 'relative', background: isHovered ? 'var(--bg-row-hover)' : (subgroupTint ?? 'var(--bg-surface)'), borderBottom: '1px solid var(--border)', cursor: isUnplaced && !isViewOnly ? 'crosshair' : 'default', transition: 'background 0.1s', display: 'flex' }}
      onMouseEnter={() => onHover(task.id)}
      onMouseLeave={() => onHover(null)}
      onClick={e => { if (rowRef.current) onRowClick(e, task, rowRef.current); }}
    >
      {columns.map((col, i) => (
        <div key={i} style={{ width: colWidth, height: '100%', flexShrink: 0, borderRight: '1px solid var(--border)', background: formatDate(col) === today ? 'var(--accent-light)' : (isWeekend(col) && colWidth < 50 ? '#f9fafb' : 'transparent') }} />
      ))}
      {isUnplaced && isHovered && !isViewOnly && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 12, pointerEvents: 'none', zIndex: 2 }}>
          <span style={{ fontSize: 11, color: project.color, fontStyle: 'italic', background: project.color + '12', padding: '2px 8px', borderRadius: 4, border: `1px dashed ${project.color}60` }}>
            {isHalf ? '→ Click to set end date' : '→ Click to set start date'}
          </span>
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, zIndex: 3 }}>
        <TaskBar task={task} color={barColor} calStart={calStartDate} ppd={ppd} rowH={rowH} preview={preview} onDragStart={onDragStart} onBarClick={onBarClick}
          onItemHover={e => onItemHover(task, barColor, e)} onItemLeave={onItemLeave} />
      </div>
    </div>
  );
}

// ─── Calendar: Milestones Row ─────────────────────────────────────────────────

function CalendarMilestonesRow({ milestones, project, rowH, totalWidth, calStartDate, ppd, columns, colWidth, isHovered, subgroupTint, isViewOnly, onHover, onRowClick, onMilestoneDragStart, onMilestoneLabelClick, milestoneRow, dragPreview, onItemHover, onItemLeave, tierMap, today }: {
  milestones: GanttMilestone[]; project: Project; rowH: number; totalWidth: number; calStartDate: Date; ppd: number;
  columns: Date[]; colWidth: number; isHovered: boolean; subgroupTint?: string; isViewOnly?: boolean; onHover: (key: string | null) => void;
  onRowClick: (e: React.MouseEvent<HTMLDivElement>, milestones: GanttMilestone[], el: HTMLDivElement) => void;
  onMilestoneDragStart: (e: React.MouseEvent, milestone: GanttMilestone) => void;
  onMilestoneLabelClick?: (e: React.MouseEvent, milestone: GanttMilestone) => void;
  milestoneRow?: MilestoneRow;
  dragPreview: CalDragPreview | null;
  onItemHover: ItemHoverFn; onItemLeave: () => void;
  tierMap: Record<string, number>;
  today: string;
}) {
  const rowRef        = useRef<HTMLDivElement>(null);
  const hoverKey      = `ms-${project.id}`;
  const hasUnplaced   = milestones.some(m => m.date === null);
  const firstUnplaced = milestones.find(m => m.date === null);
  return (
    <div
      ref={rowRef}
      style={{ height: rowH, width: totalWidth, position: 'relative', background: isHovered ? 'var(--bg-row-hover)' : (subgroupTint ?? 'var(--bg-surface)'), borderBottom: '1px solid var(--border)', cursor: hasUnplaced && !isViewOnly ? 'crosshair' : 'default', transition: 'background 0.1s', display: 'flex' }}
      onMouseEnter={() => onHover(hoverKey)}
      onMouseLeave={() => onHover(null)}
      onClick={e => { if (rowRef.current) onRowClick(e, milestones, rowRef.current); }}
    >
      {columns.map((col, i) => (
        <div key={i} style={{ width: colWidth, height: '100%', flexShrink: 0, borderRight: '1px solid var(--border)', background: formatDate(col) === today ? 'var(--accent-light)' : (isWeekend(col) && colWidth < 50 ? '#f9fafb' : 'transparent') }} />
      ))}
      {hasUnplaced && isHovered && !isViewOnly && (
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
            onLabelClick={onMilestoneLabelClick ? e => onMilestoneLabelClick(e, m) : undefined}
            icon={milestoneRow?.icon}
            onItemHover={e => onItemHover(m, m.color ?? project.color, e)} onItemLeave={onItemLeave}
            tier={tierMap[m.id] ?? 0} rowHeight={rowH}
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

  // Only reset local state when a DIFFERENT item is opened.
  // Never sync from Firestore echoes while the panel is open — the user's
  // in-panel selection is the source of truth until they save or close.
  const prevItemId = React.useRef(item.id);
  useEffect(() => {
    if (item.id !== prevItemId.current) {
      setDesc(item.description ?? "");
      setName(item.name);
      setActiveColor(item.color ?? null);
      prevItemId.current = item.id;
    }
  }, [item.id]);
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
                onClick={() => { setActiveColor(c); onSaveColor(c); }}
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
        width: '100%', padding: '8px 12px', borderRadius: 7, textAlign: 'left',
        fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 9,
        color: 'var(--text-primary)', background: 'transparent', transition: 'background 0.1s',
        fontFamily: 'var(--font)',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-row-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}
    >
      <span style={{ fontSize: 12, width: 18, textAlign: 'center', flexShrink: 0, opacity: 0.7 }}>{icon}</span>
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
  onDelete?: () => void;
}>(({ subgroup, project, rowH, isDragOver, onToggle, onDelete }, ref) => {
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div
      ref={ref}
      style={{
        height: rowH,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 4,
        paddingRight: 8,
        gap: 0,
        background: isDragOver ? project.color + '30' : project.color + '16',
        borderBottom: '1px solid ' + project.color + '28',
        borderLeft: `3px solid ${project.color}${isDragOver ? 'dd' : '80'}`,
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background 0.1s',
      }}
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
      onClick={onToggle}
    >
      {/* 18px placeholder to align with GripHandle in other rows */}
      <div style={{ width: 18, flexShrink: 0 }} />
      {/* 12px indent for level 2 */}
      <div style={{ width: 12, flexShrink: 0 }} />

      {/* Collapse arrow */}
      <span style={{
        fontSize: 8, color: project.color,
        transform: subgroup.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
        transition: 'transform 0.15s', display: 'inline-block', flexShrink: 0, marginRight: 5,
      }}>▼</span>

      {/* Subgroup icon */}
      <span style={{ fontSize: 11, color: project.color, flexShrink: 0, marginRight: 6, opacity: 0.85 }}>▤</span>

      {/* Name */}
      <span style={{
        flex: 1, fontWeight: 700, fontSize: 11.5,
        color: project.color,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        letterSpacing: '-0.01em',
      }}>
        {subgroup.name}
      </span>

      {showDelete && onDelete && (
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
      background: project.color + '0e',
      borderBottom: '1px solid ' + project.color + '22',
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

const TASKROW_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#94a3b8','#1e293b'];

const LeftPanelTaskRowGroup = React.forwardRef<HTMLDivElement, {
  row: CalendarRow & { kind: 'taskrow' };
  rowH: number;
  isHovered: boolean;
  onHover: (key: string | null) => void;
  onDeleteTask?: (id: string) => void;
  onDeleteRow?: () => void;
  onGripMouseDown?: (e: React.MouseEvent) => void;
  onUpdateColor: (color: string | null) => void;
  onRename: (name: string) => void;
}>(({ row, rowH, isHovered, onHover, onDeleteTask, onDeleteRow, onGripMouseDown, onUpdateColor, onRename }, ref) => {
  const { tasks, project, taskRow } = row;
  const key = `tr-${taskRow.id}`;
  const [showColorPicker, setShowColorPicker] = useState(false);
  const rowColor = taskRow.color ?? project.color;

  return (
    <div
      ref={ref}
      style={{ height: rowH, display: 'flex', alignItems: 'center', paddingLeft: 4, paddingRight: 8, gap: 0,
        background: isHovered ? 'var(--bg-row-hover)' : (row.subgroup ? row.project.color + '12' : 'var(--bg-surface)'),
        borderBottom: '1px solid var(--border)', transition: 'background 0.1s', position: 'relative',
        borderLeft: row.subgroup ? '3px solid ' + row.project.color + '50' : 'none',
        paddingLeft: row.subgroup ? 4 : 7 }}
      onMouseEnter={() => onHover(key)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Grip handle */}
      {onGripMouseDown && <GripHandle onMouseDown={onGripMouseDown} />}
      <div style={{ width: row.subgroup ? 24 : 20, flexShrink: 0 }} />{/* indent */}

      {/* Color dot — click to pick row color */}
      <div
        onClick={e => { e.stopPropagation(); setShowColorPicker(v => !v); }}
        title="Set row color"
        style={{ width: 11, height: 11, borderRadius: '50%', background: rowColor, flexShrink: 0, cursor: 'pointer', border: '1.5px solid rgba(0,0,0,0.1)', marginRight: 7 }}
      />

      {/* Color picker popup */}
      {showColorPicker && (
        <div style={{ position: 'absolute', left: 28, top: '100%', zIndex: 60, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: 8, display: 'flex', flexWrap: 'wrap', gap: 4, width: 140 }}
          onClick={e => e.stopPropagation()}>
          {TASKROW_COLORS.map(c => (
            <div key={c} onClick={() => { onUpdateColor(c); setShowColorPicker(false); }}
              style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', border: taskRow.color === c ? '2px solid #000' : '1px solid rgba(0,0,0,0.15)' }} />
          ))}
          <div onClick={() => { onUpdateColor(null); setShowColorPicker(false); }}
            title="Use project color"
            style={{ width: 20, height: 20, borderRadius: '50%', background: project.color, cursor: 'pointer', border: '2px dashed rgba(0,0,0,0.3)', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↺</div>
        </div>
      )}

      {/* Row name — double-click to rename */}
      <InlineNameEditor name={taskRow.name} onSave={onRename} />

      {/* Task count */}
      <span style={{ fontSize: 10, fontWeight: 600, color: rowColor,
        background: rowColor + '18', borderRadius: 10, padding: '1px 6px', flexShrink: 0 }}>
        {tasks.length}
      </span>

      {/* Delete row */}
      {isHovered && onDeleteRow && (
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
              {onDeleteTask && <button onClick={() => onDeleteTask(t.id)}
                style={{ width: 14, height: 14, borderRadius: 3, background: '#fee2e2', color: '#ef4444', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
LeftPanelTaskRowGroup.displayName = 'LeftPanelTaskRowGroup';

// ─── Calendar: Task Row Group ─────────────────────────────────────────────────
// Renders multiple task bars stacked vertically within a single ROW_H row

function CalendarTaskRowGroup({ tasks, taskRow, project, rowH, totalWidth, calStartDate, ppd, columns, colWidth, isHovered, subgroupTint, onHover, onBarClick, onRowClick, onDragStart, dragPreview, onItemHover, onItemLeave, today }: {
  tasks: GanttTask[]; taskRow: TaskRow; project: Project;
  rowH: number; totalWidth: number; calStartDate: Date; ppd: number;
  columns: Date[]; colWidth: number; isHovered: boolean;
  onHover: (key: string | null) => void;
  onBarClick?: (e: React.MouseEvent, task: GanttTask) => void;
  onRowClick: (e: React.MouseEvent<HTMLDivElement>, task: GanttTask, el: HTMLDivElement) => void;
  onDragStart: (e: React.MouseEvent, kind: 'move-task' | 'resize-left' | 'resize-right', task: GanttTask) => void;
  dragPreview: CalDragPreview | null;
  onItemHover: ItemHoverFn; onItemLeave: () => void;
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
        background: isHovered ? 'var(--bg-row-hover)' : (subgroupTint ?? 'var(--bg-surface)'),
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
          const barColor = t.color ?? taskRow.color ?? project.color;
          return (
            <div key={t.id}
              style={{ opacity: isOverlapping ? 0.65 : 1, transition: 'opacity 0.15s' }}
              onClick={t.startDate && t.endDate ? e => e.stopPropagation() : undefined}
            >
              <TaskBar
                task={t}
                color={barColor}
                calStart={calStartDate}
                ppd={ppd}
                rowH={rowH}
                preview={taskPreview}
                onDragStart={(e, kind) => onDragStart(e, kind, t)}
                onBarClick={e => { e.stopPropagation(); onBarClick(e, t); }}
                onItemHover={e => onItemHover(t, barColor, e)} onItemLeave={onItemLeave}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
