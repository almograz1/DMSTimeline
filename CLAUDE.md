# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development server (Vite at http://localhost:5173)
npm run build        # Build for production
npm run preview      # Preview production build locally
```

## Tech Stack

- **Frontend**: React 18 + TypeScript 5, Vite 5
- **State**: Context API + `useReducer` (no Redux)
- **Backend**: Firebase Firestore (real-time sync) + Firebase Auth (Google OAuth + Email/Password)
- **Styling**: Inline `style` props for components + CSS variables in `index.css`
- **Date handling**: Custom `utils/dateUtils.ts` — never use raw `Date` arithmetic or `new Date(isoString)` directly (timezone bugs)

## Architecture

### Flat Row Model

All calendar items (projects, subgroups, tasks, milestones, task rows, milestone rows) are rendered from a single `CalendarRow[]` array. This ensures perfect vertical alignment between the left panel and the calendar grid. The `CalendarRow` union type (in `types/index.ts`) is the contract between GanttChart layout logic and data state.

### `pxPerDay` Abstraction

All three view modes use the same positioning math:

```
leftPx  = dayDiff(calendarStart, startDate) * pxPerDay
widthPx = (dayDiff(startDate, endDate) + 1) * pxPerDay
```

Values:
- Daily: `pxPerDay = 44`
- Weekly: `pxPerDay ≈ 120 / 7 ≈ 17`
- Monthly: `pxPerDay ≈ 160 / 30.44`

### State Management (`context/GanttContext.tsx`)

Global reducer owns: projects, subgroups, items (tasks + milestones), task rows, milestone rows, vacations, and calendar pan/zoom.

Dual sync:
1. **Firestore → Local**: `onSnapshot` listeners push owned/shared timeline data into local state
2. **Local → Firestore**: Reducer state changes trigger `syncToFirestore()` which batches writes

Firestore batches are required for consistency — deleting a project must also delete its items.

### Multi-Timeline & Auth (`auth/TimelineContext.tsx`, `auth/AuthContext.tsx`)

Users own timelines and can be members of shared ones (via `timelineMembers` collection). Switching the active timeline resets `GanttContext`. All Firestore queries are scoped by `timelineId` for isolation.

### Key Data Types (`types/index.ts`)

```
Timeline        – Workspace owned by one user
Project         – Swim lane with color and collapse state
Subgroup        – Nested grouping under a project
GanttTask       – startDate/endDate (null until placed), optional taskRowId
GanttMilestone  – single date, optional milestoneRowId
TaskRow         – Named shared row for multiple tasks
MilestoneRow    – Named shared row for multiple milestones
VacationPeriod  – Date range blocking placement across all swim lanes
CalendarRow     – Union: header | subheader | item | taskrow | milestones
```

Dates are always stored as ISO strings (`'YYYY-MM-DD'`). Use `parseDate()` / `formatDate()` / `dayDiff()` / `addDays()` from `dateUtils.ts` for all date math.

### Component Responsibilities

- **`App.tsx`**: Root shell — provider nesting (`AuthGate → TimelineProvider → GanttProvider → AppInner`), modal state orchestration (6 modal types), toolbar
- **`GanttChart.tsx`**: Main rendering (~700+ lines) — builds `CalendarRow[]`, renders left panel (drag-reorder) and calendar grid (daily/weekly/monthly headers, task bars, milestone diamonds, mouse drag handlers)
- **Modal components** (`AddProjectModal`, `AddSubgroupModal`, `AddTaskRowModal`, `AddMilestoneRowModal`, `AddItemModal`): each takes `onClose`; Escape and backdrop click dismiss them

### Firestore Collections

```
projects/         – userId, timelineId, name, color, order, collapsed
subgroups/        – userId, timelineId, projectId, name, order, collapsed
items/            – userId, timelineId, projectId, type ('task'|'milestone'), startDate, endDate, date, order
taskRows/         – userId, timelineId, projectId, name, order
milestoneRows/    – userId, timelineId, projectId, name, icon, order
timelines/        – userId, name, createdAt
timelineMembers/  – userId, timelineId
userProfiles/     – uid, email, displayName
vacations/        – userId, timelineId, name, startDate, endDate
```

## Key Patterns

- **Drag-reorder** (left panel): dispatches `REORDER_PROJECTS` / `REORDER_ITEMS` / etc.; Firestore batch writes the new `order` fields
- **Drag-to-resize/move** (calendar grid): mouse handlers compute day deltas from px, dispatch `UPDATE_ITEM` with new dates; preview state is ephemeral local `useState` — never stored in global state
- **Click-to-place**: first click sets `startDate`, second click sets `endDate` for tasks; single click places a milestone diamond
- **Hover-delete**: red `×` appears on hover using local hover state; does not go into global state
- **ID generation**: `genId() = timestamp-${random}` (no UUIDs)

## Styling

CSS variables in `index.css` (key ones): `--left-panel-w: 280px`, `--row-h: 40px`, `--header-h: 60px`, `--toolbar-h: 52px`, plus color tokens (`--bg-app`, `--bg-toolbar`, `--border`, `--accent`). Font is "Sora" from Google Fonts. Modal/form styles use CSS classes (`.modal-backdrop`, `.form-group`, `.form-input`, `.color-grid`); everything else uses inline `style` props.
