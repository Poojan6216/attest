/**
 * The options page sections, in page order. The navigation and every section heading read from this
 * list, so the two cannot drift apart.
 */
export const SECTIONS = [
  { id: 'grants', title: 'Grants' },
  { id: 'adapters', title: 'Adapters' },
  { id: 'privacy', title: 'Privacy' },
  { id: 'model', title: 'Model' },
  { id: 'export', title: 'Export' },
  { id: 'danger-zone', title: 'Danger zone' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

export function sectionTitle(id: SectionId): string {
  return SECTIONS.find((section) => section.id === id)?.title ?? id;
}
