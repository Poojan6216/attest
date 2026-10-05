/**
 * The Calendar content script's `post` (src/observers/gcal/script.ts `snapshotPost`; sprint_2 2.7; Decisions [2.7];
 * TECH-12): each `calendar.snapshot` names the hash of the account the same pass read, never the address and never
 * another pass's account; every other message, and a snapshot whose pass named no account, goes out as the skeleton
 * built it; a refused post still rejects, so the pass stops (Hard Rule 5). Run on the labelled fixtures through the
 * skeleton, as entrypoints/content/gcal.content.ts wires it.
 */
import { describe, expect, it } from 'vitest';

import type { BusMessage } from '../../../../src/bus/messages';
import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { IsoTs } from '../../../../src/core/schema';
import { accountHashOf } from '../../../../src/observers/account';
import { runPass } from '../../../../src/observers/base';
import { snapshotPost } from '../../../../src/observers/gcal/script';
import { zoneOffset } from '../../fixtures/fixture-page-read';
import { VALID } from '../../bus/harness';
import { accountlessHtmlOf, ctxOf, docOf, fixture, observerFor, parseDocument } from './gcal-fixtures';

const WEEK = fixture('synthetic-gcal-week-after-create.html');

/** A post that records every message it is given, as the service worker would receive it. */
function recorder(): { post: (message: BusMessage) => Promise<void>; messages: BusMessage[] } {
  const messages: BusMessage[] = [];
  return {
    messages,
    post: (message) => {
      messages.push(message);
      return Promise.resolve();
    },
  };
}

/**
 * One pass of the fixture's page through the skeleton, posting through `snapshotPost`. `vouches` is the page-sync
 * answer (src/observers/lifecycle.ts): false while the page is offline or catching up after sleep.
 */
async function passThrough(doc: Document, vouches = true) {
  const observer = observerFor(WEEK);
  const sent = recorder();
  await runPass(observer, {
    doc,
    post: snapshotPost(observer, sent.post),
    now: () => WEEK.page.readAt,
    offsetAt: zoneOffset(WEEK.page.timeZone),
    policy: DEFAULT_POLICY,
    userActive: () => false,
    vouches: () => vouches,
  });
  return { observer, messages: sent.messages };
}

describe('snapshotPost', () => {
  it('a page whose account is known: no row of its own, and the snapshot names the hash that pass read', async () => {
    const { messages } = await passThrough(docOf(WEEK));
    expect(messages.map((m) => m.type)).toEqual(['adapter.health', 'coverage.ping', 'calendar.snapshot']);
    const snapshot = messages.at(-1);
    expect(snapshot?.type === 'calendar.snapshot' && snapshot.accountHash).toBe(
      accountHashOf(WEEK.page.account),
    );
    expect(JSON.stringify(messages).toLowerCase()).not.toContain(WEEK.page.account.toLowerCase());
  });

  it('a snapshot of another pass than the last one read goes out without an account', async () => {
    const { observer } = await passThrough(docOf(WEEK));
    const sent = recorder();
    const read = observer.snapshot(docOf(WEEK), ctxOf(WEEK));
    if (read === null) throw new Error('no snapshot');
    const other = { ...read, readAt: IsoTs.parse('2026-10-03T09:00:00-04:00') };
    const message = { type: 'calendar.snapshot' as const, observerId: 'gcal.event', snapshot: other };
    await snapshotPost(observer, sent.post)(message);
    expect(sent.messages).toEqual([message]);
  });

  it('a page that names no account: its rows go out as first sightings, and no snapshot names an account', async () => {
    const { observer, messages } = await passThrough(parseDocument(accountlessHtmlOf(WEEK)));
    expect(messages.map((m) => m.type)).toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
    expect(observer.passAccount(WEEK.page.readAt)).toBeNull();
    const sent = recorder();
    const read = observer.snapshot(parseDocument(accountlessHtmlOf(WEEK)), ctxOf(WEEK));
    if (read === null) throw new Error('no snapshot');
    const message = { type: 'calendar.snapshot' as const, observerId: 'gcal.event', snapshot: read };
    await snapshotPost(observer, sent.post)(message);
    expect(sent.messages).toEqual([message]);
  });

  it('every other message goes out as the skeleton built it', async () => {
    const { observer } = await passThrough(docOf(WEEK));
    const sent = recorder();
    const post = snapshotPost(observer, sent.post);
    await post(VALID['coverage.ping']);
    await post(VALID['observer.observations']);
    expect(sent.messages).toEqual([VALID['coverage.ping'], VALID['observer.observations']]);
  });

  it('a post the service worker refused rejects, snapshot or not, so the pass stops', async () => {
    const { observer } = await passThrough(docOf(WEEK));
    const refused = new Error('refused');
    const post = snapshotPost<BusMessage>(observer, () => Promise.reject(refused));
    await expect(post(VALID['coverage.ping'])).rejects.toBe(refused);
    const read = observer.snapshot(docOf(WEEK), ctxOf(WEEK));
    if (read === null) throw new Error('no snapshot');
    await expect(post({ type: 'calendar.snapshot', observerId: 'gcal.event', snapshot: read })).rejects.toBe(
      refused,
    );
  });
});

describe('a Calendar pass that cannot vouch for the present (page sync, Decisions [2.close] S4; Hard Rule 5)', () => {
  it("posts its health and no coverage ping and no snapshot, so a stale page never becomes the range's base", async () => {
    expect((await passThrough(docOf(WEEK), false)).messages.map((m) => m.type)).toEqual(['adapter.health']);
    expect((await passThrough(docOf(WEEK), true)).messages.map((m) => m.type)).toEqual([
      'adapter.health',
      'coverage.ping',
      'calendar.snapshot',
    ]);
  });

  it('a page that names no account still posts its rows (evidence), but no coverage ping and no snapshot', async () => {
    const { messages } = await passThrough(parseDocument(accountlessHtmlOf(WEEK)), false);
    expect(messages.map((m) => m.type)).toEqual(['adapter.health', 'observer.observations']);
  });
});
