/**
 * The rebuild of the ledger's database after a job sealed every record (Sprint 6 close, security review SEC-1;
 * src/ledger/rebuild.ts): Chrome's files losing the older, unsealed copies of the records.
 */
export function RebuildLine() {
  return (
    <p role="status" class="text-sm">
      Clearing the older copies of your records from Chrome’s files. Attest pauses for a moment meanwhile.
    </p>
  );
}
