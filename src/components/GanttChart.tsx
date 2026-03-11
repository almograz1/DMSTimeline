import React, { useMemo, useRef, useState, useCallback } from 'react';
import { useGantt } from '../context/GanttContext';
import type { CalendarRow, GanttTask, GanttMilestone, Project } from '../types';
import {
  parseDate, formatDate, addDays, dayDiff,
  buildDailyColumns, buildWeeklyColumns,
  getISOWeekNumber, getDayName, getMonthName,
  isWeekend, getMondayOfWeek,
} from '../utils/dateUtils';

// ─── Layout Constants ────────────────────────────────────────────────────────

const LEFT_W       = 280;   // left panel width in px
const ROW_H        = 40;    // every row (header + item) height in px
const HEADER_H     = 60;    // two-line calendar header height in px
const DAILY_COL_W  = 44;    // px per day in daily view
const WEEKLY_COL_W = 120;   // px per week in weekly view
const TASK_BAR_H   = 22;    // height of a rendered task bar
const MILESTONE_SZ = 14;    // side length of the milestone diamond box

// ─── Helper: pixels per day for the active view ──────────────────────────────

function pxPerDay(viewMode: 'daily' | 'weekly'): number {
  return viewMode === 'daily' ? DAILY_COL_W : WEEKLY_COL_W / 7;
}

// ─── Sub-component: Task Bar ─────────────────────────────────────────────────

interface TaskBarProps {
  task: GanttTask;
  color: string;
  calStart: Date;
  ppd: number; // pixels per day
  rowH: number;
}

function TaskBar({ task, color, calStart, ppd, rowH }: TaskBarProps) {
  if (!task.startDate) return null;

  const start = parseDate(task.startDate);
  const leftPx  = dayDiff(calStart, start) * ppd;

  if (task.endDate) {
    // Fully placed — render the full bar
    const end = parseDate(task.endDate);
    const widthPx = (dayDiff(start, end) + 1) * ppd;
    const topPx = (rowH - TASK_BAR_H) / 2;

    return (
      <div style={{
        position: 'absolute',
        left: leftPx,
        width: Math.max(widthPx, 4),
        top: topPx,
        height: TASK_BAR_H,
        background: color,
        borderRadius: 5,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 8,
        overflow: 'hidden',
        boxShadow: `0 1px 4px ${color}55`,
        cursor: 'default',
        transition: 'box-shadow 0.15s',
      }}
        title={`${task.name}: ${task.startDate} → ${task.endDate}`}
      >
        <span style={{
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textShadow: '0 1px 2px rgba(0,0,0,0.3)',
        }}>
          {task.name}
        </span>
      </div>
    );
  }

  // Only start date is set — show a "waiting for end" indicator
  return (
    <div style={{
      position: 'absolute',
      left: leftPx,
      top: (rowH - TASK_BAR_H) / 2,
      width: TASK_BAR_H,
      height: TASK_BAR_H,
      borderRadius: 5,
      background: color + '60',
      border: `2px dashed ${color}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
      title={`Start: ${task.startDate} — click to set end date`}
    >
      <span style={{ color, fontSize: 14, fontWeight: 700 }}>→</span>
    </div>
  );
}

// ─── Sub-component: Milestone Marker ─────────────────────────────────────────

interface MilestoneMarkerProps {
  milestone: GanttMilestone;
  color: string;
  calStart: Date;
  ppd: number;
  rowH: number;
}

function MilestoneMarker({ milestone, color, calStart, ppd, rowH }: MilestoneMarkerProps) {
  if (!milestone.date) return null;

  const date = parseDate(milestone.date);
  // Center the diamond on the date column's midpoint
  const centerX = dayDiff(calStart, date) * ppd + ppd / 2;
  const size = MILESTONE_SZ;

  return (
    <div style={{
      position: 'absolute',
      left: centerX - size / 2 - 1,
      top: (rowH - size) / 2,
      width: size,
      height: size,
      background: color,
      transform: 'rotate(45deg)',
      borderRadius: 3,
      boxShadow: `0 2px 6px ${color}66`,
      cursor: 'default',
    }}
      title={`${milestone.name}: ${milestone.date}`}
    />
  );
}

// ─── Sub-component: Unplaced hint shown in empty rows ────────────────────────

function UnplacedHint({ color, text }: { color: string; text: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '0 12px',
      height: '100%',
      pointerEvents: 'none', // The row div below handles clicks
    }}>
      <span style={{
        fontSize: 11,
        color: color + 'aa',
        fontStyle: 'italic',
      }}>
        {text}
      </span>
    </div>
  );
}

// ─── Sub-component: Calendar Header (month row + day/week row) ───────────────

interface CalendarHeaderProps {
  columns: Date[];
  viewMode: 'daily' | 'weekly';
  colWidth: number;
  todayDate: string;
}

function CalendarHeader({ columns, viewMode, colWidth, todayDate }: CalendarHeaderProps) {
  // ── Build month spans for the top header row ──────────────────────────────
  // Group consecutive columns that share the same "Month YYYY" label.
  const monthSpans: { label: string; count: number }[] = [];
  columns.forEach(col => {
    const label = `${getMonthName(col)} ${col.getFullYear()}`;
    if (monthSpans.length && monthSpans[monthSpans.length - 1].label === label) {
      monthSpans[monthSpans.length - 1].count++;
    } else {
      monthSpans.push({ label, count: 1 });
    }
  });

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: HEADER_H,
      borderBottom: '1.5px solid var(--border-strong)',
      background: 'var(--bg-header)',
      position: 'sticky',
      top: 0,
      zIndex: 5,
    }}>
      {/* Month name row */}
      <div style={{ display: 'flex', height: 24, borderBottom: '1px solid var(--border)' }}>
        {monthSpans.map(({ label, count }) => (
          <div
            key={label + count}
            style={{
              width: count * colWidth,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 8,
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-secondary)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              borderRight: '1px solid var(--border)',
              overflow: 'hidden',
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Week / Day row */}
      <div style={{ display: 'flex', flex: 1 }}>
        {columns.map((col, i) => {
          const isToday = formatDate(col) === todayDate;
          const weekend = isWeekend(col);

          return (
            <div
              key={i}
              style={{
                width: colWidth,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderRight: '1px solid var(--border)',
                fontSize: 11,
                fontWeight: isToday ? 700 : 500,
                color: isToday ? 'var(--accent)' : weekend ? 'var(--text-muted)' : 'var(--text-primary)',
                background: isToday ? 'var(--accent-light)' : 'transparent',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {viewMode === 'daily' ? (
                <>
                  <span style={{ fontSize: 9, opacity: 0.7 }}>{getDayName(col)}</span>
                  <span>{col.getDate()}</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 9, opacity: 0.7 }}>W{getISOWeekNumber(col)}</span>
                  <span>{col.getDate()} {getMonthName(col)}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main GanttChart Component ────────────────────────────────────────────────

export default function GanttChart() {
  const { state, dispatch } = useGantt();
  const { projects, items, viewMode, calendarStart, calendarDays } = state;

  const today = formatDate(new Date());
  const calStartDate = parseDate(calendarStart);
  const ppd = pxPerDay(viewMode);
  const colWidth = viewMode === 'daily' ? DAILY_COL_W : WEEKLY_COL_W;
  const numCols = viewMode === 'daily' ? calendarDays : Math.ceil(calendarDays / 7);

  // ── Build the flat row list ─────────────────────────────────────────────────
  // This single array drives both the left panel and the calendar body.
  const rows: CalendarRow[] = useMemo(() => {
    const result: CalendarRow[] = [];
    for (const project of projects) {
      result.push({ kind: 'header', project });
      if (!project.collapsed) {
        const projectItems = items.filter(i => i.projectId === project.id);
        for (const item of projectItems) {
          result.push({ kind: 'item', item, project });
        }
      }
    }
    return result;
  }, [projects, items]);

  // ── Calendar columns ────────────────────────────────────────────────────────
  const columns = useMemo(
    () => viewMode === 'daily'
      ? buildDailyColumns(calStartDate, numCols)
      : buildWeeklyColumns(calStartDate, numCols),
    [calStartDate, viewMode, numCols]
  );

  const totalCalWidth = numCols * colWidth;

  // ── Click handler: placed on each item's calendar row ──────────────────────
  // This converts the click X position → a date string, then updates the item.
  const handleCalendarRowClick = useCallback((
    e: React.MouseEvent<HTMLDivElement>,
    row: CalendarRow & { kind: 'item' },
    rowElement: HTMLDivElement
  ) => {
    // Calculate which date column was clicked
    const rect = rowElement.getBoundingClientRect();
    const xInRow = e.clientX - rect.left;
    const dayOffset = Math.floor(xInRow / ppd);
    const clickedDate = formatDate(addDays(calStartDate, dayOffset));

    const { item } = row;

    if (item.type === 'milestone') {
      // Single-click placement
      dispatch({ type: 'UPDATE_ITEM', itemId: item.id, patch: { date: clickedDate } });
    } else {
      // Task: two-click placement
      const task = item as GanttTask;

      if (!task.startDate) {
        // First click: set start date
        dispatch({ type: 'UPDATE_ITEM', itemId: task.id, patch: { startDate: clickedDate, endDate: null } });
      } else if (!task.endDate) {
        if (clickedDate >= task.startDate) {
          // Second click after start: set end date
          dispatch({ type: 'UPDATE_ITEM', itemId: task.id, patch: { endDate: clickedDate } });
        } else {
          // Clicked before start: treat as a new start (reset)
          dispatch({ type: 'UPDATE_ITEM', itemId: task.id, patch: { startDate: clickedDate, endDate: null } });
        }
      } else {
        // Already fully placed: clicking resets to move the start
        dispatch({ type: 'UPDATE_ITEM', itemId: task.id, patch: { startDate: clickedDate, endDate: null } });
      }
    }
  }, [calStartDate, ppd, dispatch]);

  // ── Delete item handler (keyboard Delete on hovered row) ───────────────────
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);

  // ── Today marker position ────────────────────────────────────────────────────
  // Horizontal line drawn at today's column position
  const todayOffset = dayDiff(calStartDate, new Date()) * ppd;
  const todayVisible = todayOffset >= 0 && todayOffset <= totalCalWidth;

  return (
    <div style={{
      flex: 1,
      overflow: 'auto',
      display: 'flex',
      background: 'var(--bg-surface)',
      position: 'relative',
    }}>
      {/* ─── Wrapper: left panel + calendar in one scrollable div ─── */}
      <div style={{ display: 'flex', minWidth: LEFT_W + totalCalWidth, minHeight: '100%' }}>

        {/* ══════════════════════════════════════════
            LEFT PANEL  (sticky left, scrolls with page vertically)
        ══════════════════════════════════════════ */}
        <div style={{
          position: 'sticky',
          left: 0,
          width: LEFT_W,
          flexShrink: 0,
          background: 'var(--bg-surface)',
          borderRight: '1.5px solid var(--border-strong)',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Left panel header (aligns with calendar column header) */}
          <div style={{
            height: HEADER_H,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 16,
            borderBottom: '1.5px solid var(--border-strong)',
            background: 'var(--bg-header)',
            position: 'sticky',
            top: 0,
            zIndex: 11,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Projects / Tasks
            </span>
          </div>

          {/* Left panel rows */}
          {rows.map((row, rowIdx) => {
            if (row.kind === 'header') {
              return (
                <LeftPanelHeader
                  key={row.project.id}
                  project={row.project}
                  rowH={ROW_H}
                  onToggle={() => dispatch({ type: 'TOGGLE_COLLAPSE', projectId: row.project.id })}
                  onDelete={() => dispatch({ type: 'DELETE_PROJECT', projectId: row.project.id })}
                />
              );
            }
            return (
              <LeftPanelItemRow
                key={row.item.id}
                row={row}
                rowH={ROW_H}
                isHovered={hoveredItemId === row.item.id}
                onHover={setHoveredItemId}
                onDelete={() => dispatch({ type: 'DELETE_ITEM', itemId: row.item.id })}
                rowIdx={rowIdx}
              />
            );
          })}
        </div>

        {/* ══════════════════════════════════════════
            CALENDAR AREA (scrolls horizontally)
        ══════════════════════════════════════════ */}
        <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>

          {/* Column headers */}
          <CalendarHeader
            columns={columns}
            viewMode={viewMode}
            colWidth={colWidth}
            todayDate={today}
          />

          {/* Calendar body rows */}
          <div style={{ position: 'relative', flex: 1 }}>

            {/* Today vertical line */}
            {todayVisible && (
              <div style={{
                position: 'absolute',
                left: todayOffset,
                top: 0,
                bottom: 0,
                width: 2,
                background: 'var(--accent)',
                opacity: 0.5,
                zIndex: 3,
                pointerEvents: 'none',
              }} />
            )}

            {rows.map((row, rowIdx) => {
              if (row.kind === 'header') {
                return (
                  <CalendarHeaderRow
                    key={row.project.id}
                    project={row.project}
                    totalWidth={totalCalWidth}
                    rowH={ROW_H}
                    columns={columns}
                    colWidth={colWidth}
                  />
                );
              }

              // Item row — clickable to place tasks/milestones
              const isUnplaced =
                row.item.type === 'task'
                  ? !(row.item as GanttTask).endDate
                  : !(row.item as GanttMilestone).date;

              const isHalf =
                row.item.type === 'task' &&
                !!(row.item as GanttTask).startDate &&
                !(row.item as GanttTask).endDate;

              return (
                <CalendarItemRow
                  key={row.item.id}
                  row={row}
                  rowH={ROW_H}
                  totalWidth={totalCalWidth}
                  calStartDate={calStartDate}
                  ppd={ppd}
                  columns={columns}
                  colWidth={colWidth}
                  isUnplaced={isUnplaced}
                  isHalf={isHalf}
                  isHovered={hoveredItemId === row.item.id}
                  onHover={setHoveredItemId}
                  onRowClick={handleCalendarRowClick}
                  today={today}
                  rowIdx={rowIdx}
                />
              );
            })}

            {/* Empty state when no projects */}
            {rows.length === 0 && (
              <div style={{
                padding: '60px 40px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
              }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
                <p style={{ fontWeight: 600, marginBottom: 6 }}>No swim lanes yet</p>
                <p>Click <strong>+ Add Swim Lane</strong> in the toolbar to get started.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Left Panel: Project Header Row ──────────────────────────────────────────

function LeftPanelHeader({
  project, rowH, onToggle, onDelete
}: {
  project: Project;
  rowH: number;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div
      style={{
        height: rowH,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 10,
        paddingRight: 8,
        gap: 6,
        background: 'var(--bg-swimlane)',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
      onClick={onToggle}
    >
      {/* Collapse/expand triangle */}
      <span style={{
        fontSize: 9,
        color: project.color,
        transform: project.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
        transition: 'transform 0.15s',
        display: 'inline-block',
        flexShrink: 0,
      }}>▼</span>

      {/* Color dot */}
      <div style={{
        width: 10, height: 10, borderRadius: 3,
        background: project.color, flexShrink: 0,
      }} />

      {/* Project name */}
      <span style={{
        flex: 1,
        fontWeight: 700,
        fontSize: 12,
        color: 'var(--text-primary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {project.name}
      </span>

      {/* Delete button (visible on hover) */}
      {showDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          title="Delete swim lane"
          style={{
            width: 20, height: 20,
            borderRadius: 4,
            background: '#fee2e2',
            color: '#ef4444',
            fontSize: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >×</button>
      )}
    </div>
  );
}

// ─── Left Panel: Item Row (task or milestone) ─────────────────────────────────

function LeftPanelItemRow({
  row, rowH, isHovered, onHover, onDelete
}: {
  row: CalendarRow & { kind: 'item' };
  rowH: number;
  isHovered: boolean;
  onHover: (id: string | null) => void;
  onDelete: () => void;
  rowIdx: number;
}) {
  const { item, project } = row;
  const isMilestone = item.type === 'milestone';

  return (
    <div
      style={{
        height: rowH,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 28,
        paddingRight: 8,
        gap: 8,
        background: isHovered ? 'var(--bg-row-hover)' : 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        transition: 'background 0.1s',
      }}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Type icon */}
      {isMilestone ? (
        // Small rotated square = diamond shape
        <div style={{
          width: 9, height: 9,
          background: project.color,
          transform: 'rotate(45deg)',
          borderRadius: 2,
          flexShrink: 0,
        }} />
      ) : (
        // Horizontal bar icon for tasks
        <div style={{
          width: 12, height: 5,
          background: project.color,
          borderRadius: 2,
          flexShrink: 0,
        }} />
      )}

      {/* Name */}
      <span style={{
        flex: 1,
        fontSize: 12,
        color: 'var(--text-primary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {item.name}
      </span>

      {/* Delete button */}
      {isHovered && (
        <button
          onClick={onDelete}
          title="Delete"
          style={{
            width: 18, height: 18,
            borderRadius: 4,
            background: '#fee2e2',
            color: '#ef4444',
            fontSize: 11,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >×</button>
      )}
    </div>
  );
}

// ─── Calendar: Project Header Row (swim lane divider) ─────────────────────────

function CalendarHeaderRow({
  project, totalWidth, rowH, columns, colWidth
}: {
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
      position: 'relative',
      background: 'var(--bg-swimlane)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
    }}>
      {/* Vertical column dividers */}
      {columns.map((col, i) => (
        <div key={i} style={{
          width: colWidth,
          height: '100%',
          borderRight: '1px solid var(--border)',
          background: isWeekend(col) && colWidth < 50 ? '#f9fafb' : 'transparent',
        }} />
      ))}
    </div>
  );
}

// ─── Calendar: Item Row ───────────────────────────────────────────────────────

interface CalendarItemRowProps {
  row: CalendarRow & { kind: 'item' };
  rowH: number;
  totalWidth: number;
  calStartDate: Date;
  ppd: number;
  columns: Date[];
  colWidth: number;
  isUnplaced: boolean;
  isHalf: boolean; // task with start but no end
  isHovered: boolean;
  onHover: (id: string | null) => void;
  onRowClick: (e: React.MouseEvent<HTMLDivElement>, row: CalendarRow & { kind: 'item' }, el: HTMLDivElement) => void;
  today: string;
  rowIdx: number;
}

function CalendarItemRow({
  row, rowH, totalWidth, calStartDate, ppd, columns, colWidth,
  isUnplaced, isHalf, isHovered, onHover, onRowClick, today
}: CalendarItemRowProps) {
  const { item, project } = row;
  const rowRef = useRef<HTMLDivElement>(null);

  // Show a pulsing cursor hint when the item needs placement
  const cursor = isUnplaced ? 'crosshair' : 'default';

  return (
    <div
      ref={rowRef}
      style={{
        height: rowH,
        width: totalWidth,
        position: 'relative',
        background: isHovered ? 'var(--bg-row-hover)' : 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        cursor,
        transition: 'background 0.1s',
        display: 'flex',
      }}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      onClick={e => {
        if (rowRef.current) onRowClick(e, row, rowRef.current);
      }}
    >
      {/* ── Column background cells ─────────────────────────────────────── */}
      {columns.map((col, i) => {
        const isToday = formatDate(col) === today;
        return (
          <div key={i} style={{
            width: colWidth,
            height: '100%',
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            background: isToday
              ? 'var(--accent-light)'
              : (isWeekend(col) && colWidth < 50 ? '#f9fafb' : 'transparent'),
          }} />
        );
      })}

      {/* ── Placement hint overlay (when not yet placed) ─────────────────── */}
      {isUnplaced && isHovered && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 12,
          pointerEvents: 'none',
          zIndex: 2,
        }}>
          <span style={{
            fontSize: 11,
            color: project.color,
            fontStyle: 'italic',
            background: project.color + '12',
            padding: '2px 8px',
            borderRadius: 4,
            border: `1px dashed ${project.color}60`,
          }}>
            {item.type === 'milestone'
              ? '🔷 Click to place milestone'
              : isHalf
                ? '→ Click to set end date'
                : '→ Click to set start date'}
          </span>
        </div>
      )}

      {/* ── Task bar or milestone marker ──────────────────────────────────── */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}>
        {item.type === 'task' ? (
          <TaskBar
            task={item as GanttTask}
            color={project.color}
            calStart={calStartDate}
            ppd={ppd}
            rowH={rowH}
          />
        ) : (
          <MilestoneMarker
            milestone={item as GanttMilestone}
            color={project.color}
            calStart={calStartDate}
            ppd={ppd}
            rowH={rowH}
          />
        )}
      </div>
    </div>
  );
}
