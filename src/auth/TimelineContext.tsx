/**
 * TimelineContext — manages the list of timelines for the logged-in user
 * and tracks which one is currently active.
 *
 * A "timeline" is a named workspace (like a project board). Each user can
 * have multiple timelines. All Gantt data (projects, subgroups, items)
 * is scoped to the active timeline.
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  collection, query, where, onSnapshot,
  doc, setDoc, deleteDoc, orderBy,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Timeline } from '../types';
import { useAuth } from './AuthContext';

interface TimelineContextValue {
  timelines: Timeline[];
  activeTimeline: Timeline | null;
  setActiveTimelineId: (id: string) => void;
  createTimeline: (name: string) => Promise<string>; // returns new id
  deleteTimeline: (id: string) => Promise<void>;
  loading: boolean;
}

const TimelineContext = createContext<TimelineContextValue | null>(null);

const TIMELINES_COL = 'timelines';

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function TimelineProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [timelines, setTimelines]               = useState<Timeline[]>([]);
  const [activeTimelineId, setActiveTimelineId] = useState<string>('');
  const [loading, setLoading]                   = useState(true);

  // Listen to this user's timelines in Firestore
  useEffect(() => {
    if (!user) {
      setTimelines([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(
      collection(db, TIMELINES_COL),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'asc')
    );

    const unsub = onSnapshot(q, snapshot => {
      const tls = snapshot.docs.map(d => d.data() as Timeline);
      setTimelines(tls);

      // Auto-select: keep current selection if still valid, else pick first
      setActiveTimelineId(prev => {
        if (prev && tls.find(t => t.id === prev)) return prev;
        return tls[0]?.id ?? '';
      });

      setLoading(false);
    }, err => {
      console.error('timelines listener:', err);
      setLoading(false);
    });

    return unsub;
  }, [user]);

  const createTimeline = useCallback(async (name: string): Promise<string> => {
    if (!user) throw new Error('Not logged in');
    const id = genId();
    const timeline: Timeline = {
      id, userId: user.uid, name, createdAt: Date.now(),
    };
    await setDoc(doc(db, TIMELINES_COL, id), timeline);
    setActiveTimelineId(id);
    return id;
  }, [user]);

  const deleteTimeline = useCallback(async (id: string) => {
    await deleteDoc(doc(db, TIMELINES_COL, id));
    // Firestore cascade not automatic — GanttContext will just show empty data
    // for the deleted timeline id. A production app would use a Cloud Function.
  }, []);

  const activeTimeline = timelines.find(t => t.id === activeTimelineId) ?? null;

  return (
    <TimelineContext.Provider value={{
      timelines, activeTimeline, setActiveTimelineId,
      createTimeline, deleteTimeline, loading,
    }}>
      {children}
    </TimelineContext.Provider>
  );
}

export function useTimeline(): TimelineContextValue {
  const ctx = useContext(TimelineContext);
  if (!ctx) throw new Error('useTimeline must be used inside <TimelineProvider>');
  return ctx;
}
