import type { ComponentChildren } from 'preact';

import { type SectionId, sectionTitle } from '../sections';

export interface SectionProps {
  readonly id: SectionId;
  /** `danger` adds a red border; the heading text ("Danger zone") carries the meaning, not the colour. */
  readonly tone?: 'default' | 'danger';
  readonly children: ComponentChildren;
}

const TONE_CLASSES = {
  default: 'border-neutral-300 dark:border-neutral-700',
  danger: 'border-red-600 dark:border-red-500',
} as const;

/** One settings section: a labelled region with an h2 and an anchor the navigation links to. */
export function Section({ id, tone = 'default', children }: SectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      class={`scroll-mt-6 rounded-lg border bg-white px-5 py-4 dark:bg-neutral-900 ${TONE_CLASSES[tone]}`}
    >
      <h2 id={headingId} class="text-lg font-semibold">
        {sectionTitle(id)}
      </h2>
      <div class="mt-2 space-y-3">{children}</div>
    </section>
  );
}
