import type { SectionId } from '../sections';
import { LaterVersionNote } from './LaterVersionNote';
import { Section } from './Section';

export interface StubSectionProps {
  readonly id: SectionId;
  /** One sentence on what the section will do. */
  readonly summary: string;
}

/** A section whose feature arrives later: what it will do, and that it is not here yet. No fake controls. */
export function StubSection({ id, summary }: StubSectionProps) {
  return (
    <Section id={id}>
      <p>{summary}</p>
      <LaterVersionNote />
    </Section>
  );
}
