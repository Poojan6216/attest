import { REFUSALS } from '../crypto-text';
import type { CommandStep } from '../use-crypto-status';

export interface CommandLineProps {
  readonly step: CommandStep;
  /** What is said once the command is done. */
  readonly done: string;
}

/** What an encryption command did, in words (sprint_6 6.5): working, done, or why not. Nothing before it is sent. */
export function CommandLine({ step, done }: CommandLineProps) {
  if (step.kind === 'idle') return null;
  if (step.kind === 'refused') {
    return (
      <p role="alert" class="text-sm text-error-fg">
        {REFUSALS[step.code]}
      </p>
    );
  }
  return (
    <p role="status" class="text-sm">
      {step.kind === 'sending' ? 'Working… this takes a second or two.' : done}
    </p>
  );
}
