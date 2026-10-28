import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type {
  CalibrationSet,
  Connectivity,
  ReviewKey,
  SessionData,
  SessionListScenario,
  StepId,
  ViewId } from
'../types/session';
import { deriveSession, type Derived } from '../utils/sessionRules';
import { ACK_NOTE, appendAudit, makeEntry } from '../utils/audit';
import { blankSession, buildSeedSessions, withRides } from '../utils/sessionFactory';
import { ENGINE_VERSION, fmt } from '../utils/calibration';
import { optionLabel } from '../utils/format';
import { prototypeOperator } from '../data/sessions';
import { finalRuleOptions, ruleSetOptions, setLabels } from '../data/options';

export interface FocusRequest {
  id: string;
  n: number;
}

export interface RestoreInfo {
  reference: string;
  step: StepId;
  savedAt: string;
}

interface SessionContextValue {
  connectivity: Connectivity;
  sessions: SessionData[];
  active: SessionData | null;
  derived: Derived | null;
  view: ViewId;
  readOnly: boolean;
  focusRequest: FocusRequest | null;
  restoreInfo: RestoreInfo | null;
  syncDialogRef: string | null;
  goTo: (view: ViewId, focusId?: string) => void;
  createSession: () => void;
  openSession: (reference: string) => void;
  update: (mutator: (s: SessionData) => SessionData) => void;
  logEdit: (field: string, from: string, to: string) => void;
  overrideStart: (set: CalibrationSet, index: number, reason: string) => void;
  relinkStart: (set: CalibrationSet, index: number) => void;
  saveDraft: () => void;
  saveSetup: () => void;
  markReviewed: (key: ReviewKey) => void;
  acknowledge: (warningId: string) => void;
  finalize: () => void;
  requestSync: (reference: string) => void;
  resolveConflict: (reference: string, choice: 'local' | 'server') => void;
  openSyncDialog: (reference: string | null) => void;
  dismissRestore: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function touch(s: SessionData): SessionData {
  return {
    ...s,
    save: 'saving',
    sync: s.sync === 'issue' ? 'issue' : 'pending',
    syncQueued: s.sync !== 'issue',
    updatedAt: new Date().toISOString()
  };
}

interface SessionProviderProps {
  connectivity: Connectivity;
  listScenario: SessionListScenario;
  children: React.ReactNode;
}

export function SessionProvider({ connectivity, listScenario, children }: SessionProviderProps) {
  const [sessions, setSessions] = useState<SessionData[]>(() => buildSeedSessions(connectivity, listScenario));
  const [activeRef, setActiveRef] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>('list');
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [restoreInfo, setRestoreInfo] = useState<RestoreInfo | null>(null);
  const [syncDialogRef, setSyncDialogRef] = useState<string | null>(null);

  const active = sessions.find((s) => s.reference === activeRef) ?? null;
  const derived = useMemo(() => active ? deriveSession(active, connectivity) : null, [active, connectivity]);
  const readOnly = !!active?.finalized;

  const patch = useCallback((ref: string, fn: (s: SessionData) => SessionData) => {
    setSessions((list) => list.map((s) => s.reference === ref ? fn(s) : s));
  }, []);

  // Local autosave: "Saving…" settles to "Saved on this device".
  useEffect(() => {
    if (!sessions.some((s) => s.save === 'saving')) return;
    const t = window.setTimeout(() => {
      setSessions((list) => list.map((s) => s.save === 'saving' ? { ...s, save: 'saved' } : s));
    }, 500);
    return () => window.clearTimeout(t);
  }, [sessions]);

  // Server sync: only when online and the change has been queued.
  useEffect(() => {
    if (connectivity === 'offline') return;
    const ready = (s: SessionData) => s.sync === 'pending' && s.save === 'saved' && s.syncQueued && !s.conflict;
    if (!sessions.some(ready)) return;
    const t = window.setTimeout(() => {
      setSessions((list) => list.map((s) => ready(s) ? { ...s, sync: 'synced', syncQueued: false } : s));
    }, 1500);
    return () => window.clearTimeout(t);
  }, [sessions, connectivity]);

  const goTo = useCallback(
    (next: ViewId, focusId?: string) => {
      setView(next);
      setRestoreInfo(null);
      if (next !== 'list' && activeRef) {
        setSessions((list) => list.map((s) => s.reference === activeRef && !s.finalized ? { ...s, lastStep: next } : s));
      }
      if (focusId) {
        setFocusRequest({ id: focusId, n: Date.now() });
        window.setTimeout(() => {
          const el = document.getElementById(focusId);
          if (el) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            el.focus({ preventScroll: true });
          }
        }, 140);
      } else {
        window.scrollTo({ top: 0 });
      }
    },
    [activeRef]
  );

  const createSession = useCallback(() => {
    const nums = sessions.map((s) => Number(s.reference.split('-')[2]) || 0);
    const ref = `BC-2026-${String(Math.max(0, ...nums) + 1).padStart(3, '0')}`;
    const s = blankSession(ref, prototypeOperator);
    setSessions((list) => [s, ...list]);
    setActiveRef(ref);
    setView('setup');
    setRestoreInfo(null);
    window.scrollTo({ top: 0 });
    toast(`${ref} created`, {
      description:
      connectivity === 'offline' ?
      'Saved on this device as a draft. It will sync when the connection returns.' :
      'Saved on this device as a draft.'
    });
  }, [sessions, connectivity]);

  const openSession = useCallback(
    (reference: string) => {
      const s = sessions.find((x) => x.reference === reference);
      if (!s) return;
      const step: StepId = s.finalized ? 'review' : s.lastStep;
      setActiveRef(reference);
      setView(step);
      setRestoreInfo(s.finalized ? null : { reference, step, savedAt: s.updatedAt });
      window.scrollTo({ top: 0 });
    },
    [sessions]
  );

  const update = useCallback(
    (mutator: (s: SessionData) => SessionData) => {
      if (!activeRef || readOnly) return;
      patch(activeRef, (s) => touch(mutator(s)));
    },
    [activeRef, readOnly, patch]
  );

  const logEdit = useCallback(
    (field: string, from: string, to: string) => {
      if (!activeRef || readOnly) return;
      patch(activeRef, (s) =>
      appendAudit(s, [makeEntry({ kind: 'edit', actor: s.operator, summary: `${field} changed`, field, from: from || 'empty', to: to || 'empty' })], connectivity)
      );
    },
    [activeRef, readOnly, patch, connectivity]
  );

  const overrideStart = useCallback(
    (set: CalibrationSet, index: number, reason: string) => {
      if (!activeRef || readOnly) return;
      patch(activeRef, (s) => {
        const linked = s[set][index - 1]?.finish ?? '';
        const rides = s[set].map((r, i) => i === index ? { ...r, startOverridden: true, start: linked, overrideReason: reason } : r);
        return appendAudit(
          touch(withRides(s, set, rides)),
          [makeEntry({ kind: 'override', actor: s.operator, summary: 'Linked start overridden', field: `${setLabels[set]} Ride ${index + 1} start`, from: `Linked (${linked || 'empty'})`, to: 'Manual entry', reason })],
          connectivity
        );
      });
    },
    [activeRef, readOnly, patch, connectivity]
  );

  const relinkStart = useCallback(
    (set: CalibrationSet, index: number) => {
      if (!activeRef || readOnly) return;
      patch(activeRef, (s) => {
        const prev = s[set][index].start;
        const rides = s[set].map((r, i) => i === index ? { ...r, startOverridden: false, start: '', overrideReason: '' } : r);
        return appendAudit(
          touch(withRides(s, set, rides)),
          [makeEntry({ kind: 'override', actor: s.operator, summary: 'Linked start restored', field: `${setLabels[set]} Ride ${index + 1} start`, from: prev || 'empty', to: `Linked (${s[set][index - 1]?.finish || 'empty'})` })],
          connectivity
        );
      });
    },
    [activeRef, readOnly, patch, connectivity]
  );

  const saveDraft = useCallback(() => {
    if (!activeRef || readOnly) return;
    patch(activeRef, touch);
    toast('Draft saved on this device', {
      description: connectivity === 'offline' ? 'Working offline — sync pending until the connection returns.' : 'Sync to the server follows automatically.'
    });
  }, [activeRef, readOnly, patch, connectivity]);

  const saveSetup = useCallback(() => {
    if (!activeRef || readOnly) return;
    patch(activeRef, (s) =>
    appendAudit(
      touch({ ...s, setupSaved: true }),
      [
      makeEntry({
        kind: 'version',
        actor: 'System',
        summary: `Setup saved · ${optionLabel(ruleSetOptions, s.ruleSet)} · ${ENGINE_VERSION} · Final constant rule: ${optionLabel(finalRuleOptions, s.finalRule)}`
      })],

      connectivity
    )
    );
  }, [activeRef, readOnly, patch, connectivity]);

  const markReviewed = useCallback(
    (key: ReviewKey) => {
      if (!activeRef || readOnly) return;
      patch(activeRef, (s) => {
        const d = deriveSession(s, connectivity);
        const summary =
        key === 'pre' ?
        `Pre-calibration calculation reviewed (WC ${fmt(d.pre.wc)})` :
        key === 'distance' ?
        `Course distance reviewed (${fmt(d.distance.km, 3)} km)` :
        `Calibration comparison reviewed (difference ${fmt(d.comparison.difference, 4)})`;
        return touch({
          ...s,
          reviews: { ...s.reviews, [key]: { signature: d.signatures[key], at: new Date().toISOString() } },
          audit: [...s.audit, makeEntry({ kind: 'review', actor: s.operator, summary })]
        });
      });
    },
    [activeRef, readOnly, patch, connectivity]
  );

  const acknowledge = useCallback(
    (warningId: string) => {
      if (!activeRef || readOnly) return;
      patch(activeRef, (s) => {
        const w = deriveSession(s, connectivity).warnings.find((x) => x.id === warningId);
        if (!w) return s;
        return touch({
          ...s,
          acknowledgements: { ...s.acknowledgements, [w.id]: { signature: w.signature, at: new Date().toISOString() } },
          audit: [...s.audit, makeEntry({ kind: 'acknowledgement', actor: s.operator, summary: `Warning reviewed: ${w.title}`, note: ACK_NOTE })]
        });
      });
    },
    [activeRef, readOnly, patch, connectivity]
  );

  const finalize = useCallback(() => {
    if (!activeRef || readOnly) return;
    patch(activeRef, (s) => {
      const d = deriveSession(s, connectivity);
      const at = new Date().toISOString();
      return touch({
        ...s,
        finalized: { at, by: s.operator },
        lastStep: 'review',
        audit: [
        ...s.audit,
        makeEntry({
          kind: 'finalization',
          actor: s.operator,
          summary: `Session finalized — course distance ${fmt(d.distance.km, 3)} km`,
          note: `${optionLabel(ruleSetOptions, s.ruleSet)} · ${ENGINE_VERSION}`
        })]

      });
    });
    toast('Session finalized', { description: 'The record is now read-only.' });
  }, [activeRef, readOnly, patch, connectivity]);

  const requestSync = useCallback(
    (reference: string) => {
      patch(reference, (s) => ({
        ...s,
        sync: 'pending',
        syncQueued: true,
        save: 'saved',
        audit: s.sync === 'issue' ? [...s.audit, makeEntry({ kind: 'sync', actor: 'System', summary: 'Sync retried after a failed attempt' })] : s.audit
      }));
      setSyncDialogRef(null);
      toast('Sync started', { description: `${reference} is being sent to the server.` });
    },
    [patch]
  );

  const resolveConflict = useCallback(
    (reference: string, choice: 'local' | 'server') => {
      patch(reference, (s) => {
        if (!s.conflict) return s;
        const c = s.conflict;
        const value = choice === 'local' ? c.local : c.server;
        const replaced = choice === 'local' ? c.server : c.local;
        const rides = s[c.set].map((r, i) => i === c.index ? { ...r, finish: value } : r);
        const next = touch({ ...withRides(s, c.set, rides), conflict: null, sync: 'pending' });
        return appendAudit(
          next,
          [
          makeEntry({
            kind: 'conflict',
            actor: s.operator,
            summary: `Sync conflict resolved — kept ${choice === 'local' ? "this device's" : 'the server'} version`,
            field: c.label,
            from: replaced,
            to: value,
            note: `Replaced value ${replaced} (${choice === 'local' ? 'server' : 'this device'}) is preserved in this record.`
          })],

          connectivity
        );
      });
      setSyncDialogRef(null);
      toast('Conflict resolved', { description: 'Affected results were recalculated. Dependent reviews may need repeating.' });
    },
    [patch, connectivity]
  );

  const value: SessionContextValue = {
    connectivity,
    sessions,
    active,
    derived,
    view,
    readOnly,
    focusRequest,
    restoreInfo,
    syncDialogRef,
    goTo,
    createSession,
    openSession,
    update,
    logEdit,
    overrideStart,
    relinkStart,
    saveDraft,
    saveSetup,
    markReviewed,
    acknowledge,
    finalize,
    requestSync,
    resolveConflict,
    openSyncDialog: setSyncDialogRef,
    dismissRestore: () => setRestoreInfo(null)
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}