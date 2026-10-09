/**
 * One agent's grant form (sprint_4 4.4): the draft the person edits, what each field must fix after a Save that did not
 * parse, and the save itself, which says that it was saved or, in words, why not. A save that failed is logged.
 */
import { useState } from 'preact/hooks';

import type { AgentId, Grant } from '../../src/core/schema';
import { log } from '../../src/log';
import { type DraftField, draftOf, type GrantDraft, grantOfDraft } from '../../src/ui/grant-form';
import type { GrantSources } from './use-grant-settings';

export type SaveState = 'idle' | 'saving' | 'saved' | 'invalid' | 'failed';

export function useGrantDraft(
  agent: AgentId,
  stored: Grant | undefined,
  muted: boolean,
  save: GrantSources['save'],
) {
  const [draft, setDraft] = useState<GrantDraft>(() => draftOf(stored, muted));
  const [errors, setErrors] = useState<Readonly<Partial<Record<DraftField, string>>>>({});
  const [state, setState] = useState<SaveState>('idle');
  const edit = (change: Partial<GrantDraft>) => {
    setDraft((current) => ({ ...current, ...change }));
    if (state === 'saved') setState('idle');
  };
  const submit = () => {
    const made = grantOfDraft(agent, draft);
    if (!made.ok) {
      setErrors(made.errors);
      setState('invalid');
      return;
    }
    setErrors({});
    setState('saving');
    save(made.grant, made.muted).then(
      (result) => {
        setState(result.ok ? 'saved' : 'failed');
      },
      (error: unknown) => {
        log.warn('options.grant_save_failed', { error });
        setState('failed');
      },
    );
  };
  return { draft, edit, errors, state, submit };
}
