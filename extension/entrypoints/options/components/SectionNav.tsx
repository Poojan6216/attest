import { SECTIONS } from '../sections';

/** In-page links to every section, in page order. */
export function SectionNav() {
  return (
    <nav aria-label="Settings sections" class="mt-6">
      <ul class="flex flex-wrap gap-2">
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              class="inline-block rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-800 underline-offset-2 hover:bg-neutral-100 hover:underline dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {section.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
