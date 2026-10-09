/**
 * The Add agent activity flow (sprint_3 3.12; docs/claims-import.md §2): closed → the form (pick the agent, paste) →
 * the preview → closed again, by Cancel or by an import. The pasted text lives in this state only while the form or
 * the preview is open: closing drops it, and it is never stored, logged or sent (Hard Rules 1, 2 and 10). Only the
 * claims go to `onImport`.
 */
import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { MAX_PASTE_CHARS, type PastedLog, type PasteRefusal, readPastedLog } from '../../src/adapters/paste';
import type { OffsetAt } from '../../src/core/normalize';
import { type AgentId, type Claim, type IsoTs, SCHEMA_LIMITS } from '../../src/core/schema';
import { count } from '../../src/ui/paste-labels';

/** The paste instant and the person's zone: the side panel's own clock (src/clock.ts, src/observers/time-zone.ts). */
export interface PasteClock {
  readonly now: () => IsoTs;
  readonly offsetAt: OffsetAt;
}

/** What sending the claims on gave: how many the ledger took and how many were new, or a failure. */
export type ImportOutcome =
  { readonly ok: true; readonly received: number; readonly added: number } | { readonly ok: false };

/** Sends the claims, never the text, to the service worker (`claims.import`, sprint_3 3.13). */
export type ImportClaims = (agent: AgentId, claims: readonly Claim[]) => Promise<ImportOutcome>;

export interface FormStep {
  readonly kind: 'form';
  readonly agent: AgentId | null;
  readonly text: string;
  readonly error: string | null;
}

export interface PreviewStep {
  readonly kind: 'preview';
  readonly agent: AgentId;
  readonly text: string;
  readonly log: PastedLog;
  readonly importing: boolean;
  readonly failed: boolean;
}

export type Step = { readonly kind: 'closed' } | FormStep | PreviewStep;

const CLOSED: Step = { kind: 'closed' };

export const NO_AGENT = 'Choose the agent first.';
export const REFUSALS: Readonly<Record<PasteRefusal, string>> = Object.freeze({
  empty: 'Paste the activity log first.',
  too_long: `This log is longer than ${MAX_PASTE_CHARS.toLocaleString('en')} characters. Paste a shorter part.`,
  too_many_claims: `This log has more than ${String(SCHEMA_LIMITS.BATCH)} claims. Paste a shorter part.`,
});

/** The form after Preview: the preview of the parsed log, or the form saying why it was refused. */
export function previewOf(form: FormStep, clock: PasteClock): FormStep | PreviewStep {
  if (form.agent === null) return { ...form, error: NO_AGENT };
  const result = readPastedLog(form.text, {
    agent: form.agent,
    pastedAt: clock.now(),
    offsetAt: clock.offsetAt,
  });
  if (!result.ok) return { ...form, error: REFUSALS[result.refusal] };
  return {
    kind: 'preview',
    agent: form.agent,
    text: form.text,
    log: result.log,
    importing: false,
    failed: false,
  };
}

/** What the panel says once an import is done: how many claims were new, and how many Attest already had. */
export function importedNotice(received: number, added: number): string {
  if (added === received) return `Imported ${count(added, 'claim', 'claims')}.`;
  if (added === 0) {
    return received === 1
      ? 'Attest already had this claim.'
      : `Attest already had all ${String(received)} claims.`;
  }
  return `Imported ${count(added, 'new claim', 'new claims')}; ${count(received - added, 'was', 'were')} already in Attest.`;
}

/** Where focus goes after a step: the Add button, the agent picker, the paste box, or the preview's heading. */
export interface FlowRefs {
  readonly add: RefObject<HTMLButtonElement>;
  readonly agent: RefObject<HTMLInputElement>;
  readonly text: RefObject<HTMLTextAreaElement>;
  readonly heading: RefObject<HTMLHeadingElement>;
}

export interface PasteFlow {
  readonly step: Step;
  readonly notice: string | null;
  readonly refs: FlowRefs;
  readonly open: () => void;
  readonly change: (form: FormStep) => void;
  readonly preview: () => void;
  readonly edit: () => void;
  readonly cancel: () => void;
  readonly send: () => void;
}

/** The flow's state, its transitions, and where focus goes after each (one request, taken once). */
export function usePasteFlow(clock: PasteClock, onImport: ImportClaims): PasteFlow {
  const [step, setStep] = useState<Step>(CLOSED);
  const [notice, setNotice] = useState<string | null>(null);
  const refs: FlowRefs = {
    add: useRef<HTMLButtonElement>(null),
    agent: useRef<HTMLInputElement>(null),
    text: useRef<HTMLTextAreaElement>(null),
    heading: useRef<HTMLHeadingElement>(null),
  };
  const focusNext = useRef<keyof FlowRefs | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    const element = target === null ? null : refs[target].current;
    // An effect of an earlier render may run first, before the element is on the page: the request waits for it.
    if (element === null) return;
    focusNext.current = null;
    element.focus();
  });
  const go = (next: Step, focus: keyof FlowRefs | null): void => {
    focusNext.current = focus;
    setStep(next);
  };
  const importNow = async (current: PreviewStep): Promise<void> => {
    go({ ...current, importing: true, failed: false }, null);
    const outcome = await onImport(current.agent, current.log.claims).catch((): ImportOutcome => ({
      ok: false,
    }));
    if (outcome.ok) {
      setNotice(importedNotice(outcome.received, outcome.added));
      go(CLOSED, 'add');
    } else go({ ...current, importing: false, failed: true }, null);
  };
  return {
    step,
    notice,
    refs,
    open: () => {
      setNotice(null);
      go({ kind: 'form', agent: null, text: '', error: null }, 'agent');
    },
    change: (form) => {
      go(form, null);
    },
    preview: () => {
      if (step.kind !== 'form') return;
      const next = previewOf(step, clock);
      go(next, next.kind === 'preview' ? 'heading' : null);
    },
    edit: () => {
      if (step.kind === 'preview')
        go({ kind: 'form', agent: step.agent, text: step.text, error: null }, 'text');
    },
    cancel: () => {
      go(CLOSED, 'add');
    },
    send: () => {
      if (step.kind === 'preview' && !step.importing) void importNow(step);
    },
  };
}
