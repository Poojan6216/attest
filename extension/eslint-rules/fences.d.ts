/** What ./fences.js shares with the fence tests (TECH-6; Decisions [6.5]). */

/** The Node built-ins extension code may not import, by bare name, subpath or `node:` (TECH-6). */
export declare const NODE_BUILTINS: readonly string[];

/** The no-restricted-imports pattern that bans them: a module name matched from its start, never a path segment. */
export declare const NODE_IMPORTS: { readonly regex: string; readonly message: string };
