/**
 * A file built a page at a time (sprint_4 4.5; ./export-file.ts, ./export-csv.ts): text goes in, and after each page
 * what was written becomes a Blob part, so the page's strings can go and the browser keeps the file's bytes.
 */
/** The file being written. */
export interface FileWriter {
  write(text: string): void;
  /** Moves what was written so far into a Blob part (after every page). */
  flush(): void;
  done(type: string): Blob;
}

export function fileWriter(): FileWriter {
  const parts: Blob[] = [];
  let pending: string[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    parts.push(new Blob(pending));
    pending = [];
  };
  return {
    write: (text) => {
      pending.push(text);
    },
    flush,
    done: (type) => {
      flush();
      return new Blob(parts, { type });
    },
  };
}
