/**
 * One read of the page per pass (sprint_2 TECH-2). A pass (./plan.ts `planPass`) asks an observer for its health,
 * its rows, its windows and its account one after another, in one synchronous run over one page, and each of them
 * used to read the page again. `perPass(read)` is `read` kept for the synchronous run that first calls it: every
 * later call with the same document in that run returns the same result, and the result is dropped at the next
 * microtask, so the next pass, and any code after an `await`, reads the page afresh.
 *
 * Nothing on the page can change in between: no page script runs and no MutationObserver callback is delivered
 * inside a synchronous run. Only code that changes the document itself and reads it again before yielding could
 * see a stale read. No observer does (Hard Rule 3: it never writes the page); a test that does must yield
 * (`await Promise.resolve()`) between the change and the next read.
 *
 * A read is a pure function of the page; this changes how often it runs, never what it returns. Nothing here
 * writes the page, posts or stores anything.
 */

/** `read`, kept per document for the synchronous run that made the read (see the module comment). */
export function perPass<T>(read: (doc: Document) => T): (doc: Document) => T {
  const kept = new WeakMap<Document, { readonly value: T }>();
  return (doc) => {
    const memo = kept.get(doc);
    if (memo !== undefined) return memo.value;
    const value = read(doc);
    kept.set(doc, { value });
    queueMicrotask(() => {
      kept.delete(doc);
    });
    return value;
  };
}
