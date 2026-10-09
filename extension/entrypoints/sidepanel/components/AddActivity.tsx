import { Button } from '../../../src/ui/Button';
import { type ImportClaims, type PasteClock, usePasteFlow } from '../use-paste-flow';
import { ActivityForm } from './ActivityForm';
import { PastePreview } from './PastePreview';

export interface AddActivityProps {
  readonly clock: PasteClock;
  readonly onImport: ImportClaims;
}

/**
 * Add agent activity (sprint_3 3.12; docs/claims-import.md §2): the button, then the form, then the preview
 * (../use-paste-flow.ts). The status line stays mounted, so the import's result is announced when it changes.
 */
export function AddActivity({ clock, onImport }: AddActivityProps) {
  const flow = usePasteFlow(clock, onImport);
  const { step, refs } = flow;
  return (
    <div class="space-y-3">
      {step.kind === 'closed' && (
        <Button variant="secondary" buttonRef={refs.add} onClick={flow.open}>
          Add agent activity
        </Button>
      )}
      {step.kind === 'form' && (
        <ActivityForm
          form={step}
          onChange={flow.change}
          onPreview={flow.preview}
          onCancel={flow.cancel}
          agentRef={refs.agent}
          textRef={refs.text}
        />
      )}
      {step.kind === 'preview' && (
        <PastePreview
          preview={step}
          onImport={flow.send}
          onEdit={flow.edit}
          onCancel={flow.cancel}
          headingRef={refs.heading}
        />
      )}
      <p role="status">{step.kind === 'closed' ? (flow.notice ?? '') : ''}</p>
    </div>
  );
}
