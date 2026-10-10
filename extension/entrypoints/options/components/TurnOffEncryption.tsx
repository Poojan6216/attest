import { useState } from 'preact/hooks';

import { Button } from '../../../src/ui/Button';
import { type CryptoSources, useCryptoCommand } from '../use-crypto-status';
import { CommandLine } from './CommandLine';
import { PassphraseField } from './PassphraseField';

/** Turning encryption off (sprint_6 6.5): the passphrase in use, then every record is opened for good. */
export function TurnOffEncryption({ send }: { readonly send: CryptoSources['send'] }) {
  const [passphrase, setPassphrase] = useState('');
  const command = useCryptoCommand(send);
  const submit = (event: Event): void => {
    event.preventDefault();
    command.run({ type: 'crypto.disable', passphrase });
  };
  return (
    <form class="space-y-2" onSubmit={submit}>
      <h3 class="font-medium">Turn off encryption</h3>
      <p class="text-sm">Your records are then kept unsealed in this browser, as before you turned it on.</p>
      <PassphraseField
        label="Passphrase in use"
        value={passphrase}
        onInput={setPassphrase}
        autoComplete="current-password"
      />
      <Button variant="danger-outline" type="submit" disabled={command.step.kind === 'sending'}>
        Turn off encryption
      </Button>
      <CommandLine step={command.step} done="Turning off. Attest is opening your records." />
    </form>
  );
}
