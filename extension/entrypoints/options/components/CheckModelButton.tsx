import { Button } from '../../../src/ui/Button';
import type { BuiltinModelToggleProps } from './BuiltinModelToggle';

/** The check a person asks for, where this Chrome has the Prompt API and has not said its model is ready. */
export function CheckModelButton({
  availability,
  checking,
  check,
}: Pick<BuiltinModelToggleProps, 'availability' | 'checking' | 'check'>) {
  if (availability === 'no_api' || availability === 'available') return null;
  return (
    <Button variant="secondary" disabled={checking} onClick={check}>
      Check Chrome’s on-device model
    </Button>
  );
}
