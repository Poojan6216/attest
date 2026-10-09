/**
 * The telemetry choice (sprint_4 4.5): present, off and disabled until the opt-in telemetry arrives (Sprint 5). It
 * says so, and what it will be: off unless the person turns it on, numbers only (Hard Rule 1).
 */
export function TelemetryToggle() {
  return (
    <div class="space-y-1">
      <label class="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
        <input type="checkbox" checked={false} disabled aria-describedby="telemetry-note" />
        Send anonymous usage numbers
      </label>
      <p id="telemetry-note" class="text-sm text-neutral-600 dark:text-neutral-400">
        Coming in a later version. It will stay off unless you turn it on, and it will send numbers only,
        never anything Attest read.
      </p>
    </div>
  );
}
