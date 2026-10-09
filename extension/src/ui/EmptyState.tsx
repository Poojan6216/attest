import type { ComponentChildren } from 'preact';

export interface EmptyStateProps {
  /** What is empty, said plainly: "No receipts today". */
  readonly title: string;
  /** What the person can do about it, if anything. */
  readonly children?: ComponentChildren;
}

/** An empty list, said in words, never a blank (sprint_4 4.2 done-when). */
export function EmptyState({ title, children }: EmptyStateProps) {
  return (
    <div role="status" class="rounded-md border border-dashed border-rule p-gutter text-center text-sm">
      <p class="font-medium text-ink">{title}</p>
      {children === undefined ? null : <div class="mt-1 text-ink-muted">{children}</div>}
    </div>
  );
}
