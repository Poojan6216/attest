/**
 * Runs `read` with no two at once: a call during a read runs it once more after it (sprint_4 4.3; shared by the side
 * panel's timeline and ./use-ledger-read.ts since the sprint_4 close). Pure: no clock, no DOM.
 */
export function serial(read: () => Promise<void>): () => void {
  let running = false;
  let again = false;
  // Read through a call: a call during the await sets it, which the type checker cannot see.
  const asked = (): boolean => again;
  const run = async (): Promise<void> => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await read();
      } while (asked());
    } finally {
      running = false;
    }
  };
  return () => {
    void run();
  };
}
