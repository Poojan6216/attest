import { UnlockForm, type UnlockFormProps } from './UnlockForm';

export interface LockedNoticeProps extends UnlockFormProps {
  /** What unlocking lets the page show, as the end of "Type your passphrase to …". */
  readonly toShow: string;
}

/**
 * What a page shows while the ledger is encrypted and locked (sprint_6 6.5): that it is, never a failure or an empty
 * list, and the unlock prompt. Nothing is read until the passphrase opens the ledger.
 */
export function LockedNotice({ toShow, unlock }: LockedNoticeProps) {
  return (
    <div class="space-y-2">
      <p role="status">Your records are encrypted and locked. Type your passphrase to {toShow}.</p>
      <UnlockForm {...(unlock === undefined ? {} : { unlock })} />
    </div>
  );
}
