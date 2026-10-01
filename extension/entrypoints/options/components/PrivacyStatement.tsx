/** The first line of the options page (ux_engineer rule 8). */
export function PrivacyStatement() {
  return (
    <div class="rounded-lg border border-neutral-300 bg-white px-5 py-4 dark:border-neutral-700 dark:bg-neutral-900">
      <p class="text-base font-semibold">Nothing leaves your browser.</p>
      <p class="mt-1 text-neutral-700 dark:text-neutral-300">
        Attest reads only pages you have open, keeps what it finds in this browser, and sends nothing to any
        server.
      </p>
    </div>
  );
}
