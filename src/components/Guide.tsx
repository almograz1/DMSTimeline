import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';

/**
 * Beginner onboarding guide.
 *
 * - Shows a one-time welcome prompt the first time a user reaches the app
 *   (tracked per-uid in localStorage), offering to run a guided tour.
 * - The "?" button in the toolbar dispatches `dms:open-guide` to replay it.
 * - Each step that points at a control renders a spotlight: the target stays at
 *   full brightness while the rest of the page is dimmed, so it's obvious which
 *   button the copy is talking about.
 */

export const OPEN_GUIDE_EVENT = 'dms:open-guide';

const seenKey = (uid: string) => `dms-guide-seen-${uid}`;

interface Step {
  title: string;
  body: string;
  /** CSS selector of the control to spotlight; omit for a centred, page-level step */
  target?: string;
}

const STEPS: Step[] = [
  {
    title: 'Timelines are your workspaces',
    target: '[data-tour="timeline"]',
    body:
      'Each timeline is a separate plan. Switch between them here, create a new one with +, ' +
      'or share the current one with teammates using the 🔗 button.',
  },
  {
    title: 'Build your plan from here',
    target: '[data-tour="add"]',
    body:
      'Start with a Swim Lane (a project or workstream). Then add Tasks (date ranges), ' +
      'Milestones (single dates), and Task Rows, Milestone Rows or Subgroups to organise them.',
  },
  {
    title: 'Zoom through time',
    target: '[data-tour="views"]',
    body:
      'Switch between Day, Week, Month and Year to plan at the right level of detail. ' +
      'Bars keep their real dates — only the scale changes.',
  },
  {
    title: 'Move around the calendar',
    target: '[data-tour="nav"]',
    body:
      'Use ‹ › to pan and ‹‹ ›› to jump further. Today snaps the view back to the current date.',
  },
  {
    title: 'Working on the chart',
    body:
      'Left side: your swim lanes and rows. Double-click any lane or row name to rename it; ' +
      'drag the ⠿ handle to reorder. On the grid, click an empty task row to place a task, then ' +
      'drag its middle to move it or its edges to resize. Click any bar or milestone to edit its ' +
      'name, colour, font size and notes. Right-click the grid to quick-add items or block out a vacation.',
  },
  {
    title: 'Chain items together',
    target: '[data-tour="tool-link"]',
    body:
      'Click 🔗 Link to enter link mode, then click two items to chain them. Chained items always ' +
      'move together — drag any one of them and the rest shift by the same amount. Click Link again to exit.',
  },
  {
    title: 'Export to PDF',
    target: '[data-tour="tool-pdf"]',
    body:
      'The ⬇ PDF button renders the entire timeline — every lane and the full date range — into a ' +
      'single high-quality PDF you can share or print.',
  },
  {
    title: 'Fine-tune the zoom',
    target: '[data-tour="tool-zoom"]',
    body:
      'The − / + buttons zoom the current view (Day, Week, Month or Year) in and out, so you can ' +
      'fit more on screen or spread things out for detail.',
  },
  {
    title: 'Undo anything',
    body: 'Made a mistake? Press Ctrl+Z (⌘Z on Mac) to undo your last change — deletes included.',
  },
  {
    title: 'Reopen this guide anytime',
    target: '[data-tour="help"]',
    body: 'Click the ? button whenever you want to run through this tour again. Happy planning!',
  },
];

const DIALOG_W = 360;
const RING_PAD = 8;
const DIM = 'rgba(15, 23, 42, 0.55)';

type Phase = 'hidden' | 'welcome' | 'tour';

export default function Guide() {
  const { user, needsDisplayName } = useAuth();
  const [phase, setPhase] = useState<Phase>('hidden');
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const autoPrompted = useRef(false);

  const markSeen = useCallback(() => {
    if (user) {
      try { localStorage.setItem(seenKey(user.uid), '1'); } catch { /* ignore */ }
    }
  }, [user]);

  // First-visit welcome prompt (once per account, and never over the name modal).
  useEffect(() => {
    if (!user || needsDisplayName || autoPrompted.current) return;
    let seen = false;
    try { seen = localStorage.getItem(seenKey(user.uid)) === '1'; } catch { /* ignore */ }
    if (!seen) {
      autoPrompted.current = true;
      setPhase('welcome');
    }
  }, [user, needsDisplayName]);

  // "?" button (and any other caller) can open the tour directly.
  useEffect(() => {
    function open() { setStepIdx(0); setPhase('tour'); }
    window.addEventListener(OPEN_GUIDE_EVENT, open);
    return () => window.removeEventListener(OPEN_GUIDE_EVENT, open);
  }, []);

  const close = useCallback(() => { markSeen(); setPhase('hidden'); }, [markSeen]);

  // Keep the spotlight glued to its target across layout shifts.
  useLayoutEffect(() => {
    if (phase !== 'tour') return;
    const sel = STEPS[stepIdx]?.target;
    function update() {
      const next = sel ? document.querySelector(sel)?.getBoundingClientRect() ?? null : null;
      setRect(prev => {
        if (prev === next) return prev;
        if (prev && next && prev.top === next.top && prev.left === next.left
          && prev.width === next.width && prev.height === next.height) return prev;
        return next;
      });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const poll = window.setInterval(update, 400);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.clearInterval(poll);
    };
  }, [phase, stepIdx]);

  // Esc closes the tour.
  useEffect(() => {
    if (phase !== 'tour') return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') setStepIdx(i => Math.min(i + 1, STEPS.length - 1));
      else if (e.key === 'ArrowLeft') setStepIdx(i => Math.max(i - 1, 0));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, close]);

  if (phase === 'hidden' || !user) return null;

  if (phase === 'welcome') {
    return (
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(15,17,26,0.5)',
          backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div style={{
          background: 'var(--bg-surface)', borderRadius: 14, padding: 28, width: 420,
          boxShadow: '0 12px 48px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🧭</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>New here?</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Take a 60-second tour of the essentials</div>
            </div>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
            We'll walk through swim lanes, tasks, milestones, the time views and a few handy
            shortcuts. You can reopen it anytime from the <strong style={{ color: 'var(--text-primary)' }}>?</strong> button in the toolbar.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-ghost" style={{ fontSize: 12 }} onClick={close}>Skip for now</button>
            <div style={{ flex: 1 }} />
            <button className="btn-primary" style={{ minWidth: 130 }} onClick={() => { setStepIdx(0); setPhase('tour'); }}>
              Start the tour
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Tour ──────────────────────────────────────────────────────────────────
  const step = STEPS[stepIdx];
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === STEPS.length - 1;

  // Dialog placement: below the target if there's room, otherwise above; centred
  // when the step has no target (or the target isn't on screen).
  let dialogStyle: React.CSSProperties;
  if (rect) {
    const below = rect.bottom + 14;
    const wantAbove = below + 210 > window.innerHeight;
    const top = wantAbove ? Math.max(14, rect.top - 14 - 210) : below;
    const left = Math.min(Math.max(14, rect.left), window.innerWidth - DIALOG_W - 14);
    dialogStyle = { top, left };
  } else {
    dialogStyle = {
      top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    };
  }

  return (
    <>
      {/* Click-catcher: blocks the app while the tour is active */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 9000, cursor: 'default' }} />

      {/* Spotlight ring (or full dim when there's no target) */}
      {rect ? (
        <div
          style={{
            position: 'fixed',
            top: rect.top - RING_PAD,
            left: rect.left - RING_PAD,
            width: rect.width + RING_PAD * 2,
            height: rect.height + RING_PAD * 2,
            borderRadius: 10,
            zIndex: 9001,
            pointerEvents: 'none',
            boxShadow: `${DIM} 0 0 0 9999px, 0 0 0 2px #fff, 0 0 0 7px rgba(99,102,241,0.35)`,
            transition: 'top 0.2s, left 0.2s, width 0.2s, height 0.2s',
          }}
        />
      ) : (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9001, background: DIM, pointerEvents: 'none' }} />
      )}

      {/* Step dialog */}
      <div
        style={{
          position: 'fixed', zIndex: 9002, width: DIALOG_W,
          background: 'var(--bg-surface)', borderRadius: 12, padding: 18,
          boxShadow: '0 16px 48px rgba(0,0,0,0.28)', border: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 12,
          ...dialogStyle,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', flex: 1, lineHeight: 1.35, letterSpacing: '-0.01em' }}>
            {step.title}
          </div>
          <button
            onClick={close}
            title="Close tour (Esc)"
            style={{ width: 22, height: 22, borderRadius: 5, background: 'var(--bg-header)', color: 'var(--text-secondary)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >×</button>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
          {step.body}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
            {stepIdx + 1} / {STEPS.length}
          </span>
          <div style={{ flex: 1 }} />
          {!isFirst && (
            <button
              onClick={() => setStepIdx(i => Math.max(i - 1, 0))}
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', padding: '6px 12px', borderRadius: 6, background: 'var(--bg-app)' }}
            >
              Back
            </button>
          )}
          <button
            onClick={() => { if (isLast) close(); else setStepIdx(i => Math.min(i + 1, STEPS.length - 1)); }}
            style={{ fontSize: 12, fontWeight: 700, color: '#fff', padding: '6px 14px', borderRadius: 6, background: 'var(--accent)' }}
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </>
  );
}
