import { PRIVACY_DOC_URL } from '../../../src/config';

/**
 * What encryption at rest does and does not protect, in plain words (sprint_6 6.5; docs/privacy-architecture.md §12,
 * which the link opens): shown whether it is on or off.
 */
export function EncryptionStatement() {
  return (
    <>
      <p>
        Encryption seals your records with a passphrase only you know, so someone who copies your Chrome
        profile cannot read them. It is off unless you turn it on, and you then unlock Attest once each time
        Chrome or Attest starts.
      </p>
      <ul class="list-disc space-y-1 pl-5 text-sm">
        <li>
          Sealed: addresses, subjects, amounts, merchants, what your agents claimed, your grants and marks,
          and every receipt's detail.
        </li>
        <li>
          Not sealed: ids, hashes, dates, grades and states, which Attest needs to find your records, and your
          settings.
        </li>
        <li>
          Turning it on, or a new passphrase, ends with Attest rebuilding its database, so Chrome’s files keep
          no copy of your records as they were before. A tool that recovers deleted files from the disk itself
          may still find one: full-disk encryption covers that.
        </li>
        <li>
          While unlocked, anyone using this browser can see your records, as without encryption. Lock now
          locks them at once.
        </li>
        <li>
          If you forget the passphrase, nobody can open your records. Delete all data is the only way back.
        </li>
      </ul>
      <p class="text-sm">
        <a
          href={`${PRIVACY_DOC_URL}#12-encryption-at-rest`}
          target="_blank"
          rel="noopener noreferrer"
          class="underline"
        >
          What encryption protects<span class="sr-only"> (opens a new tab)</span>
        </a>
      </p>
    </>
  );
}
