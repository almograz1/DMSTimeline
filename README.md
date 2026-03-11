# GanttFlow — A TeamGantt-Inspired Gantt Chart App

A clean React + TypeScript Gantt chart with swim lanes, tasks, milestones, and daily/weekly views.

---

## 🚀 Setup & Run

```bash
# 1. Install dependencies
npm install

# 2. Start the development server
npm run dev

# 3. Open http://localhost:5173 in your browser
```

---

## 📁 Project Structure

```
src/
├── types/
│   └── index.ts          ← All TypeScript interfaces (Project, GanttTask, GanttMilestone, etc.)
│
├── utils/
│   └── dateUtils.ts      ← All date math helpers (formatDate, parseDate, dayDiff, etc.)
│                            Never do raw Date arithmetic in components — use these.
│
├── context/
│   └── GanttContext.tsx  ← Global state via useReducer + Context API
│                            All state mutations go through the reducer here.
│
├── components/
│   ├── GanttChart.tsx    ← Main chart: left panel + calendar grid + task bars + milestones
│   ├── AddProjectModal.tsx  ← "New Swim Lane" modal with color picker
│   └── AddItemModal.tsx  ← "New Task" / "New Milestone" modal
│
├── App.tsx               ← App shell: toolbar, modal orchestration, layout
├── main.tsx              ← React root entry point
└── index.css             ← CSS variables (design tokens), global styles, reusable classes
```

---

## 🎯 How to Use

### Adding a Swim Lane (Project)
1. Click **+ Swim Lane** in the toolbar
2. Enter a name and pick a color
3. Click **Create Swim Lane**

### Adding a Task
1. Click **▬ Task** in the toolbar
2. Enter a name and select which project it belongs to
3. Click **Create Task** → the task row appears in the left panel
4. **Click once** in that task's calendar row → sets the **start date** (a `→` marker appears)
5. **Click again** in the same row → sets the **end date** → the full bar renders
   - ⚠️ If you click before the start date, it resets the start

### Adding a Milestone
1. Click **◆ Milestone** in the toolbar
2. Enter a name and select a project
3. Click **Create Milestone** → row appears
4. **Click once** in the milestone's calendar row → the diamond marker is placed

### Navigating the Calendar
| Button | Action |
|--------|--------|
| `‹‹` / `››` | Jump 4 weeks back / forward |
| `‹` / `›`   | Step 1 week (or 1 day in daily view) |
| `Today`     | Jump back to the current date window |
| `☀ Day` / `📅 Week` | Toggle between daily and weekly column layout |

### Deleting Items
- Hover over any **project header** or **task/milestone row** in the left panel → a red **×** button appears → click to delete

---

## 🏗️ Architecture Notes

### The `pxPerDay` Abstraction
The key insight for making daily/weekly views share the same rendering math:
```
Daily view:  pxPerDay = 44           (each column = 1 day = 44px)
Weekly view: pxPerDay = 120 / 7 ≈ 17 (each column = 7 days = 120px)
```
Task bar left/width and milestone position all use:
```
leftPx  = dayDiff(calendarStart, startDate) * pxPerDay
widthPx = (dayDiff(startDate, endDate) + 1) * pxPerDay
```
This means switching views just changes `pxPerDay` — no separate rendering logic needed.

### Flat Row Model
Both the left panel and the calendar grid render from a single flat `CalendarRow[]` array:
```
[ { kind: 'header', project }, { kind: 'item', item, project }, ... ]
```
This guarantees perfect vertical alignment between the two panels.

### Date Storage
Dates are stored as ISO strings (`'YYYY-MM-DD'`) in state, never as `Date` objects.
Use `parseDate()` when you need to compute, and `formatDate()` when writing back.
This avoids serialization bugs and makes state easy to inspect.

---

## 🔧 Extending the App

**Add drag-to-resize task bars**: Attach `onMouseDown` to the right edge of `<TaskBar>`, track mouse delta in `px → days`, and dispatch `UPDATE_ITEM` with the new `endDate`.

**Add per-row context menus**: Replace the hover-delete buttons with a right-click context menu component.

**Persist to localStorage**: In `GanttProvider`, load initial state from `localStorage.getItem('gantt-state')` and add a `useEffect` that saves `JSON.stringify(state)` on every state change.

**Add progress %**: Extend `GanttTask` with a `progress: number` field and render a lighter-colored fill inside the task bar.
