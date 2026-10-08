/**
 * The one error type of the fixture-capture tool. Every failure carries a stable string code so the CLI,
 * the tests, and the docs can name it; messages explain the fix and never echo captured page content.
 */
export type CaptureErrorCode =
  | 'bad_args'
  | 'bad_selector'
  | 'bad_seeds'
  | 'bad_key'
  | 'too_few_seeds'
  | 'bad_labels'
  | 'exists'
  | 'cdp_unreachable'
  | 'no_tab'
  | 'ambiguous_tab'
  | 'foreign_at'
  | 'io_failed';

/** True for a Node system error with the given errno code (ENOENT, EEXIST, …). */
export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export class CaptureError extends Error {
  override readonly name = 'CaptureError';

  constructor(
    readonly code: CaptureErrorCode,
    message: string,
  ) {
    super(message);
  }
}
