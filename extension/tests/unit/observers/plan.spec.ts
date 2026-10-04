// @vitest-environment happy-dom
/**
 * src/observers/plan.ts (sprint_2 2.0; docs/grading.md §3 observer obligations): health() runs first and a DEGRADED
 * page is never extracted; only allowlisted fields survive project(); a refused row makes the pass DEGRADED and
 * writes no coverage (Sprint 1 close, SEC-3, Hard Rule 5); every observation carries the pass instant as observedAt.
 */
import { describe, expect, it, vi } from 'vitest';

import { OBSERVER_HOSTS } from '../../../src/config';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { contentHashOf } from '../../../src/core/redact';
import { IsoTs } from '../../../src/core/schema';
import { accountHashOf } from '../../../src/observers/account';
import { type PassPlan, planPass } from '../../../src/observers/plan';
import type { ExtractContext, Observer, RawRow } from '../../../src/observers/types';
import { NOW, ROWS, SEEDS, sentObserver, syntheticDocument } from './helpers';

const ctx: ExtractContext = { observedAt: IsoTs.parse(NOW), offsetAt: () => -240 };

function plan(observer: Observer = sentObserver(), doc: Document = syntheticDocument()): PassPlan {
  return planPass({ observer, doc, ctx, policy: DEFAULT_POLICY });
}

function reasonsOf(result: PassPlan): readonly string[] {
  return result.status === 'DEGRADED' ? result.reasons : [];
}

const row = (fields: object, type: RawRow['type'] = 'email.sent'): RawRow => ({ type, fields });

describe('a clean pass', () => {
  it('is OK, reports every row with only allowlisted fields, and the coverage facts', () => {
    const result = plan();
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') return;
    expect(result.observations).toHaveLength(ROWS.length);
    for (const observation of result.observations) {
      expect(Object.keys(observation).sort()).toEqual(
        [
          'contentHash',
          'counterparty',
          'id',
          'observedAt',
          'occurredAt',
          'rowKeyHash',
          'source',
          'subjectHint',
          'type',
        ].sort(),
      );
      expect(observation.observedAt).toBe(NOW);
      expect(observation).not.toHaveProperty('sightedAt');
      expect(contentHashOf(observation)).toBe(observation.contentHash);
    }
    expect(result.observations[0]?.subjectHint).toBe('Q3 deck and plan');
    expect(result.coverage).toEqual({
      windowStart: '2026-10-01T13:10:00-04:00',
      windowEnd: NOW,
      accountHash: accountHashOf('priya.raman@example.com'),
    });
  });

  it('never carries a seeded secret or the raw account address (Hard Rule 2)', () => {
    const text = JSON.stringify(plan()).toLowerCase();
    for (const seed of SEEDS) expect(text).not.toContain(seed.toLowerCase());
    expect(text).not.toContain('priya');
  });

  it('reports a row seen twice in one pass once (same contentHash, §10)', () => {
    const twice = sentObserver({ extract: () => [row({ occurredAt: NOW }), row({ occurredAt: NOW })] });
    const result = plan(twice);
    expect(result.status).toBe('OK');
    expect(result.observations).toHaveLength(1);
  });

  it('keeps two identical sends with different row keys as two', () => {
    const keyed = (rowKey: string): RawRow => ({ type: 'email.sent', rowKey, fields: { occurredAt: NOW } });
    expect(plan(sentObserver({ extract: () => [keyed('a'), keyed('b')] })).observations).toHaveLength(2);
  });

  it('with no account shown, is OK and sends coverage without an account hash', () => {
    const result = plan(sentObserver(), syntheticDocument({ account: null }));
    expect(result.status).toBe('OK');
    if (result.status === 'OK') expect(result.coverage).not.toHaveProperty('accountHash');
  });
});

describe('health runs first', () => {
  it('DEGRADED health: nothing is extracted and no coverage (Hard Rule 6)', () => {
    const extract = vi.fn(() => [] as RawRow[]);
    const visibleWindow = vi.fn(() => null);
    const result = plan(sentObserver({ extract, visibleWindow }), syntheticDocument({ folder: 'drafts' }));
    expect(result).toEqual({ status: 'DEGRADED', reasons: ['not_sent_folder'], observations: [] });
    expect(extract).not.toHaveBeenCalled();
    expect(visibleWindow).not.toHaveBeenCalled();
  });

  it.each<[string, () => unknown, string]>([
    [
      'throws',
      () => {
        throw new Error(SEEDS[0]);
      },
      'health.threw',
    ],
    [
      'quotes the page in a reason',
      () => ({ status: 'DEGRADED', reasons: ['Sent folder missing'] }),
      'health.invalid',
    ],
    ['gives no reason', () => ({ status: 'DEGRADED', reasons: [] }), 'health.invalid'],
    ['answers an unknown status', () => ({ status: 'FINE' }), 'health.invalid'],
    ['adds a field', () => ({ status: 'OK', note: SEEDS[0] }), 'health.invalid'],
    ['answers nothing', () => undefined, 'health.invalid'],
  ])('health that %s is DEGRADED %s, and nothing is extracted', (_label, health, reason) => {
    const extract = vi.fn(() => [] as RawRow[]);
    const result = plan(sentObserver({ health: health as Observer['health'], extract }));
    expect(result).toEqual({ status: 'DEGRADED', reasons: [reason], observations: [] });
    expect(extract).not.toHaveBeenCalled();
  });
});

describe('extraction', () => {
  const good = row({ counterparty: 'sam@example.org', occurredAt: NOW });
  it.each<[string, () => unknown, string]>([
    [
      'throws',
      () => {
        throw new Error('boom');
      },
      'extract.threw',
    ],
    ['returns no list', () => ({ rows: [good] }), 'extract.invalid'],
    ['returns a row without fields', () => [good, { type: 'email.sent' }], 'extract.invalid'],
    [
      'returns a row of an unknown type',
      () => [good, { type: 'email.drafted', fields: {} }],
      'extract.invalid',
    ],
    [
      'returns a numeric row key',
      () => [good, { type: 'email.sent', rowKey: 7, fields: {} }],
      'extract.invalid',
    ],
    [
      'returns a type its source does not serve',
      () => [good, row({ occurredAt: NOW }, 'purchase.made')],
      'extract.foreign_type',
    ],
  ])(
    'an extractor that %s makes the pass DEGRADED (%s), and none of its rows is reported',
    (_label, extract, reason) => {
      const result = plan(sentObserver({ extract: extract as Observer['extract'] }));
      expect(result).toEqual({ status: 'DEGRADED', reasons: [reason], observations: [] });
    },
  );
});

describe('a row project() refuses (Sprint 1 close, SEC-3; Hard Rule 5)', () => {
  it.each<[string, object, string]>([
    ['a two-line subject', { subjectHint: 'line one\nline two', occurredAt: NOW }, 'redact.invalid_field'],
    [
      'a control character in a name',
      { counterparty: 'Alex\u0007', occurredAt: NOW },
      'redact.invalid_field',
    ],
    ['no time', { counterparty: 'alex@example.com' }, 'redact.missing_occurred_at'],
    ['a time without an offset', { occurredAt: '2026-10-01T14:02:00' }, 'redact.missing_occurred_at'],
  ])('%s: DEGRADED with %s, no coverage, the other rows still reported', (_label, fields, reason) => {
    const good = row({ counterparty: 'sam@example.org', occurredAt: NOW });
    const result = plan(sentObserver({ extract: () => [good, row(fields)] }));
    expect(result.status).toBe('DEGRADED');
    expect(reasonsOf(result)).toEqual([reason]);
    expect(result).not.toHaveProperty('coverage');
    expect(result.observations.map((o) => o.counterparty)).toEqual(['sam@example.org']);
  });

  it('a getter is never invoked and refuses the row', () => {
    const getter = vi.fn(() => 'alex@example.com');
    const fields = Object.defineProperty({ occurredAt: NOW }, 'counterparty', {
      get: getter,
      enumerable: true,
    });
    const result = plan(sentObserver({ extract: () => [row(fields)] }));
    expect(reasonsOf(result)).toEqual(['redact.invalid_field']);
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('account and window', () => {
  it.each<[string, Partial<Observer>, string]>([
    [
      'the account read throws',
      {
        account: () => {
          throw new Error('x');
        },
      },
      'account.threw',
    ],
    ['the account is not an address', { account: () => 'Priya Raman' }, 'account.invalid'],
    [
      'the window read throws',
      {
        visibleWindow: () => {
          throw new Error('x');
        },
      },
      'window.threw',
    ],
    ['the window is unknown', { visibleWindow: () => null }, 'window.unknown'],
    [
      'the window has no offset',
      { visibleWindow: () => ({ windowStart: '2026-10-01T13:00:00', windowEnd: NOW }) },
      'window.invalid',
    ],
    [
      'the window ends before it starts',
      { visibleWindow: () => ({ windowStart: NOW, windowEnd: '2026-10-01T13:00:00-04:00' }) },
      'window.invalid',
    ],
  ])('%s: DEGRADED (%s), no coverage, rows still reported', (_label, overrides, reason) => {
    const result = plan(sentObserver(overrides));
    expect(result.status).toBe('DEGRADED');
    expect(reasonsOf(result)).toEqual([reason]);
    expect(result.observations).toHaveLength(ROWS.length);
  });

  it('a refused row and an unknown window are both named', () => {
    const result = plan(
      sentObserver({
        extract: () => [row({ subjectHint: 'a\nb', occurredAt: NOW })],
        visibleWindow: () => null,
      }),
    );
    expect(reasonsOf(result)).toEqual(['redact.invalid_field', 'window.unknown']);
  });
});

describe('window shapes', () => {
  it('a window end without an offset is invalid too', () => {
    const result = plan(
      sentObserver({
        visibleWindow: () => ({ windowStart: '2026-10-01T13:00:00-04:00', windowEnd: '2026-10-01T14:00:00' }),
      }),
    );
    expect(reasonsOf(result)).toEqual(['window.invalid']);
  });

  it('a calendar window may end after the pass instant (a week view shows days to come)', () => {
    const ahead = { windowStart: NOW, windowEnd: '2026-10-08T00:00:00-04:00' };
    const calendar = sentObserver({
      source: 'gcal.event',
      hosts: OBSERVER_HOSTS.gcal,
      extract: () => [
        row({ subjectHint: 'Standup', occurredAt: '2026-10-02T09:00:00-04:00' }, 'calendar.created'),
      ],
      visibleWindow: () => ahead,
    });
    const result = plan(calendar);
    expect(result.status).toBe('OK');
    if (result.status === 'OK') expect(result.coverage.windowEnd).toBe(ahead.windowEnd);
  });
});

describe('a Gmail window never ends after the pass instant (docs/grading.md §3, §6.1; Hard Rule 5)', () => {
  const receiptRow = row(
    { merchant: 'Stripe', amountCents: 999, currency: 'USD', occurredAt: '2026-10-01T14:00:00-04:00' },
    'purchase.made',
  );

  it.each<[string, Partial<Observer>]>([
    ['gmail.sent', {}],
    ['gmail.receipt', { source: 'gmail.receipt', extract: () => [receiptRow] }],
  ])(
    '%s: a window 1 ms past the pass is DEGRADED (window.future), rows kept, no coverage',
    (_source, base) => {
      const future = { windowStart: '2026-10-01T13:00:00-04:00', windowEnd: '2026-10-01T14:30:00.001-04:00' };
      const result = plan(sentObserver({ ...base, visibleWindow: () => future }));
      expect(result.status).toBe('DEGRADED');
      expect(reasonsOf(result)).toEqual(['window.future']);
      expect(result).not.toHaveProperty('coverage');
      expect(result.observations.length).toBeGreaterThan(0);
    },
  );

  it('a window ending exactly at the pass instant, in any offset, is OK (instants are compared, not text)', () => {
    for (const windowEnd of [NOW, '2026-10-01T18:30:00Z', '2026-10-02T00:00:00+05:30']) {
      const result = plan(
        sentObserver({ visibleWindow: () => ({ windowStart: '2026-10-01T13:00:00-04:00', windowEnd }) }),
      );
      expect(result.status, windowEnd).toBe('OK');
    }
  });

  it('a window ahead of the pass only in local wall-clock text is OK when its instant is not', () => {
    const windowEnd = '2026-10-01T20:00:00+05:30'; // 14:30Z: before the pass (18:30Z), though "20:00" reads later
    const result = plan(
      sentObserver({ visibleWindow: () => ({ windowStart: '2026-10-01T09:00:00-04:00', windowEnd }) }),
    );
    expect(result.status).toBe('OK');
  });
});

describe('what an extractor may not hand the skeleton', () => {
  it('a row whose fields are a list is not a row (extract.invalid)', () => {
    const result = plan(sentObserver({ extract: () => [{ type: 'email.sent', fields: [NOW] }] }));
    expect(result).toEqual({ status: 'DEGRADED', reasons: ['extract.invalid'], observations: [] });
  });

  it('a row project() fails on with anything but a RedactError is DEGRADED as redact.threw', () => {
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error(SEEDS[0]);
        },
      },
    );
    const good = row({ counterparty: 'sam@example.org', occurredAt: NOW });
    const result = plan(sentObserver({ extract: () => [good, row(hostile)] }));
    expect(reasonsOf(result)).toEqual(['redact.threw']);
    expect(JSON.stringify(result)).not.toContain(SEEDS[0]);
    expect(result.observations).toHaveLength(1);
  });
});
