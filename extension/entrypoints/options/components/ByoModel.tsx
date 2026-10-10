import { useState } from 'preact/hooks';

import { ByoKey } from '../../../src/bus/page-commands';
import type { SettingResult } from '../../../src/bus/messages';
import { BYO_VENDOR_NAMES, BYO_VENDORS, type ByoVendor } from '../../../src/config';
import { log } from '../../../src/log';
import { Button } from '../../../src/ui/Button';
import type { SettingCommand } from '../use-settings';

export interface ByoModelProps {
  /** Whether the person's own key is on (flag ATTEST_MODEL_BYO). */
  readonly on: boolean;
  /** The vendor of the saved key, or null when none is saved. */
  readonly vendor: ByoVendor | null;
  readonly send: (command: SettingCommand) => Promise<SettingResult>;
}

type Step = 'idle' | 'saving' | 'failed' | 'not_a_key';

/** What the person's own key sends, to whom, and what stays here (agents/intel_engineer.md rule 6). */
function ByoStatement() {
  return (
    <>
      <p class="text-sm">
        Off unless you turn it on with a key you saved. While it is on, for each claim Attest checks it sends,
        with your key, to Anthropic ({BYO_VENDORS.anthropic.host}) or OpenAI ({BYO_VENDORS.openai.host}),
        whichever your key is for: what kind of action the claim was, who it was to (an email address or a
        name), its short subject, its amount and its time, and the same for each item that might match.
        Nothing else: never a page, never what you asked an agent.
      </p>
      <p class="text-sm">
        Your key stays in this browser, where only Attest can read it, and goes only to that company. They
        keep what they receive under their own terms, and each check is billed to your key. If Chrome’s
        on-device model is on and ready, Attest uses it instead and sends nothing. Like it, your key’s model
        never decides a grade.
      </p>
    </>
  );
}

/** Whose key it is: one vendor of BYO_VENDOR_NAMES. */
function VendorChoice({
  vendor,
  choose,
}: {
  readonly vendor: ByoVendor;
  readonly choose: (vendor: ByoVendor) => void;
}) {
  return (
    <fieldset class="flex gap-4 text-sm">
      <legend class="sr-only">Whose key</legend>
      {BYO_VENDOR_NAMES.map((name) => (
        <label key={name} class="flex items-center gap-1">
          <input
            type="radio"
            name="byo-vendor"
            checked={vendor === name}
            onChange={() => {
              choose(name);
            }}
          />
          {BYO_VENDORS[name].label}
        </label>
      ))}
    </fieldset>
  );
}

/** The key's vendor and the key itself, saved through the service worker; the key is checked before it is sent. */
function ByoKeyForm({
  send,
  done,
}: {
  readonly send: ByoModelProps['send'];
  readonly done: (step: Step) => void;
}) {
  const [vendor, setVendor] = useState<ByoVendor>('anthropic');
  const [key, setKey] = useState('');
  const save = (): void => {
    if (!ByoKey.safeParse(key.trim()).success) {
      done('not_a_key');
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

/** The person's own key (sprint_5 5.3): what it sends and to whom, the key saved or forgotten, and its switch. */
export function ByoModel({ on, vendor, send }: ByoModelProps) {
  const [step, setStep] = useState<Step>('idle');
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
      {step === 'not_a_key' ? (
        <p role="alert" class="text-sm text-error-fg">
          That is not a key as Anthropic or OpenAI write one: letters, digits, - and _, 20 to 300 characters.
        </p>
      ) : null}
      {step === 'failed' ? (
        <p role="alert" class="text-sm text-error-fg">
          Not changed. Try again.
        </p>
      ) : null}
    </div>
  );
}
