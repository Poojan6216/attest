import { useState } from 'preact/hooks';

import { Button } from '../../../src/ui/Button';
import { newPassphraseProblem } from '../crypto-text';
import { type CryptoSources, useCryptoCommand } from '../use-crypto-status';
import { CommandLine } from './CommandLine';
import { PassphraseField } from './PassphraseField';

/** A new passphrase (sprint_6 6.5): the one in use, then the new one twice; every record is sealed again under it. */
export function ChangePassphrase({ send }: { readonly send: CryptoSources['send'] }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const command = useCryptoCommand(send);
  const submit = (event: Event): void => {
    event.preventDefault();
    const problem = newPassphraseProblem(next, again);
    if (problem !== undefined) command.refuse(problem);
    else command.run({ type: 'crypto.change', passphrase: current, next });
  };
  return (
    <form class="space-y-2" onSubmit={submit}>
      <h3 class="font-medium">Change the passphrase</h3>
      <PassphraseField
        label="Passphrase in use"
        value={current}
        onInput={setCurrent}
        autoComplete="current-password"
      />
      <PassphraseField label="New passphrase" value={next} onInput={setNext} autoComplete="new-password" />
      <PassphraseField
        label="Type the new one again"
        value={again}
        onInput={setAgain}
        autoComplete="new-password"
      />
      <Button variant="secondary" type="submit" disabled={command.step.kind === 'sending'}>
        Change passphrase
      </Button>
      <CommandLine
        step={command.step}
        done="Changed. Attest is sealing your records again under the new passphrase."
      />
    </form>
  );
}
