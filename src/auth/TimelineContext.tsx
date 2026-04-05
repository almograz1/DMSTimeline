import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  collection, query, where, onSnapshot,
  doc, setDoc, deleteDoc, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Timeline } from '../types';
import { useAuth } from './AuthContext';

interface TimelineContextValue {
  timelines: Timeline[];
  activeTimeline: Timeline | null;
  setActiveTimelineId: (id: string) => void;
  createTimeline: (name: string) => Promise<string>;
  deleteTimeline: (id: string) => Promise<void>;
  loading: boolean;
}

const TimelineContext = createContext<TimelineContextValue | null>(null);
const TIMELINES_COL = 'timelines';
const MEMBERS_COL   = 'timelineMembers';

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function TimelineProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [timelines, setTimelines]               = useState<Timeline[]>([]);
  const [activeTimelineId, setActiveTimelineId] = useState<string>('');
  const [loading, setLoading]                   = useState(true);

  useEffect(() => {
    if (!user) {
      setTimelines([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let ownedTls:  Timeline[] = [];
    let sharedTls: Timeline[] = [];
    let loadedCount = 0;

    function merge() {
      loadedCount++;
      if (loadedCount < 2) return; // wait for both listeners
      // Combine owned + shared, deduplicate by id, sort by createdAt
      const all = [...ownedTls];
      for (const t of sharedTls) {
        if (!all.find(x => x.id === t.id)) all.push(t);
      }
      all.sort((a, b) => a.createdAt - b.createdAt);
      setTimelines(all);
      setActiveTimelineId(prev => {
        if (prev && all.find(t => t.id === prev)) return prev;
        return all[0]?.id ?? '';
      });
      setLoading(false);
    }

    // 1. Timelines I own
    const unsubOwned = onSnapshot(
      query(collection(db, TIMELINES_COL), where('userId', '==', user.uid)),
      snap => {
        ownedTls = snap.docs.map(d => d.data() as Timeline)
          .sort((a, b) => a.createdAt - b.createdAt);
        merge();
      },
      err => { console.error('owned timelines:', err); merge(); }
    );

    // 2. Timelines shared with me (via timelineMembers)
    const unsubMembers = onSnapshot(
      query(collection(db, MEMBERS_COL), where('userId', '==', user.uid)),
      async snap => {
        if (snap.empty) { sharedTls = []; merge(); return; }
        // Fetch each shared timeline document
        const ids = snap.docs.map(d => (d.data() as { timelineId: string }).timelineId);
        const fetched: Timeline[] = [];
        for (const id of ids) {
          const tSnap = await getDocs(query(collection(db, TIMELINES_COL), where('id', '==', id)));
          tSnap.docs.forEach(d => fetched.push(d.data() as Timeline));
        }
        sharedTls = fetched;
        merge();
      },
      err => { console.error('shared timelines:', err); merge(); }
    );

    return () => { unsubOwned(); unsubMembers(); };
  }, [user]);

  const createTimeline = useCallback(async (name: string): Promise<string> => {
    if (!user) throw new Error('Not logged in');
    const id = genId();
    const timeline: Timeline = {
      id, userId: user.uid, name, createdAt: Date.now(),
      ownerEmail: user.email ?? '',
    } as Timeline & { ownerEmail: string };
    await setDoc(doc(db, TIMELINES_COL, id), timeline);
    // Also add owner as a member so queries work uniformly
    await setDoc(doc(db, MEMBERS_COL, `${id}_${user.uid}`), {
      timelineId: id,
      userId:     user.uid,
      email:      user.email ?? '',
      role:       'owner',
    });
    setActiveTimelineId(id);
    return id;
  }, [user]);

  const deleteTimeline = useCallback(async (id: string) => {
    await deleteDoc(doc(db, TIMELINES_COL, id));
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
