/** The lists ./core-names.js shares with the grep test and the runtime guard (FS-1, R4-FENCE-1, R4-FENCE-2). */

/** Globals that open a network channel (attest/no-network, Hard Rule 1). */
export declare const NETWORK_GLOBALS: ReadonlySet<string>;

/** Member names that reach the network however they are reached (attest/no-network, Hard Rule 1). */
export declare const NETWORK_PROPERTIES: ReadonlySet<string>;

/** The globals src/core may not read (its no-restricted-globals list, Hard Rule 4). */
export declare const CORE_RESTRICTED_GLOBAL_NAMES: readonly string[];

/** ES2023 built-ins src/core may not read although they are no host's (eval, Function, Proxy, escape, unescape). */
export declare const CORE_UNSAFE_BUILTINS: ReadonlySet<string>;

/** Every global src/core may read: the ES2023 built-ins less the two lists above (attest/core-globals). */
export declare const CORE_ALLOWED_GLOBALS: ReadonlySet<string>;
