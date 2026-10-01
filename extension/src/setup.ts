/**
 * Runtime setup. MUST be the first import of every entrypoint (a unit test enforces this).
 *
 * Zod 4 probes for `eval` support with `new Function("")` the first time it builds an object schema
 * unless it is configured jitless. Under the extension's CSP (`script-src 'self'`, Hard Rule 9) that
 * probe is blocked and Chrome reports a CSP violation in the console, even though Zod catches it.
 * Jitless mode never probes and never generates code; validation is identical, only slower.
 */
import { z } from 'zod';

z.config({ jitless: true });
