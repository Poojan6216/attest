import { useState } from 'preact/hooks';

import type { SettingResult } from '../../../src/bus/messages';
import { BYO_VENDORS, type ByoVendor } from '../../../src/config';
import { log } from '../../../src/log';
import { Button } from '../../../src/ui/Button';
import type { SettingCommand } from '../use-settings';
import { ByoAlert } from './ByoAlert';
import { ByoKeyForm, type ByoStep } from './ByoKeyForm';
import { ByoStatement } from './ByoStatement';

export interface ByoModelProps {
  /** Whether the person's own key is on (flag ATTEST_MODEL_BYO). */
  readonly on: boolean;
  /** The vendor of the saved key, or null when none is saved. */
  readonly vendor: ByoVendor | null;
  readonly send: (command: SettingCommand) => Promise<SettingResult>;
}

/** The person's own key (sprint_5 5.3): what it sends and to whom, the key saved or forgotten, and its switch. */
export function ByoModel({ on, vendor, send }: ByoModelProps) {
  const [step, setStep] = useState<ByoStep>('idle');
  const run = (command: SettingCommand): void => {
    setStep('saving');
    send(command).then(
      (result) => {
        setStep(result.ok ? 'idle' : 'failed');
      },
      (error: unknown) => {
        log.warn('options.byo_toggle_failed', { error });
        setStep('failed');
      },
    );
  };
  return (
    <div role="group" aria-labelledby="byo-model-heading" class="space-y-2">
      <h3 id="byo-model-heading" class="font-semibold">
        Your own model key
      </h3>
      <ByoStatement />
      <p role="status" class="text-sm">
        {on ? 'Your own key is on.' : 'Your own key is off.'}{' '}
        {vendor === null ? 'No key is saved.' : `Your ${BYO_VENDORS[vendor].label} key is saved.`}
      </p>
      {vendor === null ? (
        <ByoKeyForm send={send} done={setStep} />
      ) : (
        <Button
          variant="secondary"
          disabled={step === 'saving'}
          onClick={() => {
            run({ type: 'byo.forget' });
          }}
        >
          Forget my key
        </Button>
      )}
      <Button
        variant="secondary"
        disabled={step === 'saving' || (!on && vendor === null)}
        onClick={() => {
          run({ type: 'flag.set', flag: 'ATTEST_MODEL_BYO', on: !on });
        }}
      >
        {on ? 'Turn off my own key' : 'Turn on my own key'}
      </Button>
      <ByoAlert step={step} />
    </div>
  );
}
