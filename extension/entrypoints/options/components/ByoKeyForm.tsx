import { useState } from 'preact/hooks';

import type { SettingResult } from '../../../src/bus/messages';
import { ByoKey, keyFitsVendor } from '../../../src/bus/page-commands';
import type { ByoVendor } from '../../../src/config';
import { log } from '../../../src/log';
import { Button } from '../../../src/ui/Button';
import type { SettingCommand } from '../use-settings';
import { VendorChoice } from './VendorChoice';

/** Where a save or a switch of the person's own key stands. */
export type ByoStep = 'idle' | 'saving' | 'failed' | 'not_a_key' | 'wrong_vendor';

/**
 * The key's vendor and the key itself, saved through the service worker; the key is checked before it is sent, its
 * shape and that it is the chosen vendor's.
 */
export function ByoKeyForm({
  send,
  done,
}: {
  readonly send: (command: SettingCommand) => Promise<SettingResult>;
  readonly done: (step: ByoStep) => void;
}) {
  const [vendor, setVendor] = useState<ByoVendor>('anthropic');
  const [key, setKey] = useState('');
  const save = (): void => {
    if (!ByoKey.safeParse(key.trim()).success) {
      done('not_a_key');
      return;
    }
    // Never another company's key under this one (Sprint 5 close, security review SEC-7).
    if (!keyFitsVendor(vendor, key.trim())) {
      done('wrong_vendor');
      return;
    }
    done('saving');
    send({ type: 'byo.save', vendor, key: key.trim() }).then(
      (result) => {
        done(result.ok ? 'idle' : 'failed');
        if (result.ok) setKey('');
      },
      (error: unknown) => {
        log.warn('options.byo_save_failed', { error });
        done('failed');
      },
    );
  };
  return (
    <div class="space-y-2">
      <VendorChoice vendor={vendor} choose={setVendor} />
      <label class="block text-sm">
        Your key
        <input
          type="password"
          autoComplete="off"
          spellcheck={false}
          class="mt-1 block w-full rounded border border-rule bg-surface px-2 py-1"
          value={key}
          onInput={(event) => {
            setKey(event.currentTarget.value);
          }}
        />
      </label>
      <Button variant="secondary" onClick={save}>
        Save key
      </Button>
    </div>
  );
}
