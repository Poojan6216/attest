import type { TelemetryView } from '../telemetry-preview';

/**
 * The numbers for the last whole day, exactly as built (sprint_5 5.7): before that day is sent, exactly what the next
 * send holds; after, said to be sent (Sprint 5 close, security review SEC-8: the caption never calls a sent day "next").
 * `null` when the numbers could not be read at all; `locked` while the records are (Sprint 6 close, TECH-8).
 */
export function TelemetryPreview({ view }: { readonly view: TelemetryView | null | undefined | 'locked' }) {
  if (view === undefined) return <p class="text-sm">Reading the numbers the next send would hold.</p>;
  if (view === 'locked') {
    return (
      <p class="text-sm">Your records are locked. Unlock them to see the numbers the next send would hold.</p>
    );
  }
  if (view === null) return <p class="text-sm">Attest cannot build the numbers on this browser.</p>;
  if (view.payload === null)
    return <p class="text-sm">Attest cannot build the numbers for {view.day} on this browser.</p>;
  return (
    <figure class="space-y-1">
      <figcaption class="text-sm">
        {view.sent
          ? `The numbers for ${view.day}, already sent:`
          : `Exactly what the next send holds, the numbers for ${view.day}:`}
      </figcaption>
      <pre
        aria-label="The usage numbers"
        data-verbatim=""
        tabIndex={0}
        class="max-h-64 overflow-auto rounded border border-rule p-2 text-xs"
      >
        {JSON.stringify(view.payload, null, 2)}
      </pre>
    </figure>
  );
}
