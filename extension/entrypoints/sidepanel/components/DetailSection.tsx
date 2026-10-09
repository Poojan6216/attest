import type { ComponentChildren } from 'preact';

export interface DetailSectionProps {
  readonly title: string;
  readonly children: ComponentChildren;
}

/** One titled part of a receipt's detail. */
export function DetailSection({ title, children }: DetailSectionProps) {
  return (
    <section class="space-y-1">
      <h3 class="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}
