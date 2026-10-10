/**
 * Chrome's major version as a user agent names it (sprint_5 5.7; Sprint 5 close, tech review TECH-7: one reader for
 * the usage numbers' facts and the model check's recording). Pure.
 */

/** Chrome's major version as `userAgent` names it (headless Chrome's too), or null. */
export function chromeMajorOf(userAgent: string): number | null {
  const major = /\b(?:Headless)?Chrome\/([0-9]{1,3})\./u.exec(userAgent)?.[1];
  return major === undefined ? null : Number(major);
}
