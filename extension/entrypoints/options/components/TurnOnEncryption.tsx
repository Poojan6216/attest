import { useState } from 'preact/hooks';

import { Button } from '../../../src/ui/Button';
import { newPassphraseProblem } from '../crypto-text';
import { type CryptoSources, useCryptoCommand } from '../use-crypto-status';
import { CommandLine } from './CommandLine';
import { PassphraseField } from './PassphraseField';

/**
 * Turning encryption on (sprint_6 6.5): a new passphrase, typed twice, and the person's word that they know a forgotten
 * one cannot be recovered, each checked before anything is sent.
 */
export function TurnOnEncryption({ send }: { readonly send: CryptoSources['send'] }) {
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [understood, setUnderstood] = useState(false);
  const command = useCryptoCommand(send);
  const submit = (event: Event): void => {
    event.preventDefault();
    const problem = newPassphraseProblem(passphrase, again);
    if (problem !== undefined) command.refuse(problem);
    else if (!understood) command.refuse('unconfirmed');
    else command.run({ type: 'crypto.enable', passphrase });
  };
  return (
    <form class="space-y-2" onSubmit={submit}>
      <h3 class="font-medium">Turn on encryption</h3>
      <PassphraseField
        label="New passphrase"
        value={passphrase}
        onInput={setPassphrase}
        autoComplete="new-password"
      />
      <PassphraseField label="Type it again" value={again} onInput={setAgain} autoComplete="new-password" />
      <label class="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          class="mt-1"
          checked={understood}
          onChange={(event) => {
            setUnderstood(event.currentTarget.checked);
          }}
        />
        <span>
          I understand that if I forget this passphrase, Attest cannot open my records, and Delete all data is
          the only way back.
        </span>
      </label>
      <Button variant="primary" type="submit" disabled={command.step.kind === 'sending'}>
        Turn on encryption
      </Button>
      <CommandLine step={command.step} done="Encryption is on. Attest is sealing your records." />
    </form>
  );
}
