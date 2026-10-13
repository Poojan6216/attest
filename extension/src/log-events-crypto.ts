/**
 * The log events of encryption at rest (sprint_6 6.5; src/background/crypto.ts, keep-awake.ts, rebuild.ts), part of
 * ./log-vocabulary.ts's LOG_EVENTS: apart from it so that file stays within its size, as ./log-error-names.ts is.
 * Never a passphrase or a key.
 */
export const CRYPTO_LOG_EVENTS = [
  'crypto.catch_up_failed',
  'crypto.changed',
  'crypto.command_failed',
  'crypto.disabling',
  'crypto.enabled',
  'crypto.job_done',
  'crypto.job_failed',
  'crypto.job_paused',
  'crypto.keep_awake_failed',
  'crypto.key_record_invalid',
  'crypto.locked',
  'crypto.session_clear_failed',
  'crypto.unlock_refused',
  'crypto.unlocked',
  'alarm.locked',
  'ui.unlock_failed',
  'options.crypto_failed',
  // The person's own model key, sealed while encryption is on (Sprint 6 close, SEC-2; src/background/byo.ts).
  'byo.key_opened',
  'byo.key_sealed',
  'byo.save_locked',
  'byo.seal_failed',
  // Rebuilding the ledger's database (Sprint 6 close, security review SEC-1; src/background/rebuild.ts).
  'ledger.rebuilt',
  'ledger.rebuild_failed',
  'ledger.rebuild_mark_failed',
  'ledger.rebuild_mark_unread',
  'ledger.rebuild_resumed',
] as const;
