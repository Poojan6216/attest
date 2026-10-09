export interface SkeletonProps {
  /** How many placeholder rows to draw. */
  readonly rows: number;
  /** What is loading, for screen readers: "Loading today's receipts". */
  readonly label: string;
}

/**
 * Placeholder rows while a read is under way (agents/ux_engineer.md rule 9), shaped like receipt rows: a chip, a line,
 * a badge. They pulse only when the person has not asked for reduced motion. Screen readers hear the label.
 */
export function Skeleton({ rows, label }: SkeletonProps) {
  return (
    <div role="status" aria-busy="true">
      <span class="sr-only">{label}</span>
      <ul aria-hidden="true" class="space-y-row">
        {Array.from({ length: rows }, (_, row) => (
          <li key={row} class="flex items-center gap-2">
            <span class="h-5 w-20 shrink-0 rounded-full bg-skeleton motion-safe:animate-pulse" />
            <span class="h-4 flex-1 rounded bg-skeleton motion-safe:animate-pulse" />
            <span class="h-5 w-12 shrink-0 rounded bg-skeleton motion-safe:animate-pulse" />
          </li>
        ))}
      </ul>
    </div>
  );
}
