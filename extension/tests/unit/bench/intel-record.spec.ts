/**
 * The own-key recorder of the advisory model's bench (bench/intel-record.ts; sprint_5 5.5): it reads its vendor and
 * key file from its arguments and refuses anything else; it takes a key only in a key's shape; and, through the
 * extension's own provider over a stubbed `fetch` (never a vendor), it sends every bench input to exactly the vendor's
 * endpoint with the key in its header alone, and writes a recording the bench reads, with no key, hint or input in it.
 * Every value is invented.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { byoRecording, keyFrom, recordArgs, recordByo } from '../../../../bench/intel-record';
import { BENCH_INPUTS } from '../../../entrypoints/model-check/record';
import { BYO_VENDORS } from '../../../src/config-network';
import { byoProvider } from '../../../src/intel/providers/byo';
import { setLogSink } from '../../../src/log';
import { IntelRecording } from '../intel/corpus';

const KEY = 'sk-ant-invented-recorder-0123456789';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('recordArgs and keyFrom', () => {
  it('reads the vendor and the key file, and refuses anything else, never echoing a key', () => {
    expect(recordArgs(['--vendor', 'anthropic', '--key-file', '/tmp/k'])).toEqual({
      ok: true,
      vendor: 'anthropic',
      keyFile: '/tmp/k',
    });
    for (const argv of [
      [],
      ['--vendor', 'mistral', '--key-file', '/tmp/k'],
      ['--vendor', 'openai'],
      ['--vendor', 'openai', '--key-file', '--x'],
    ]) {
      const args = recordArgs(argv);
      expect(args.ok, argv.join(' ')).toBe(false);
    }
    expect(keyFrom(`  ${KEY}\n`)).toBe(KEY);
    expect(keyFrom('short')).toBeNull();
    expect(keyFrom('sk-ant with spaces 0123456789')).toBeNull();
  });
});

describe('recordByo', () => {
  it('sends each input to the vendor’s endpoint alone, the key in its header, and writes a keyless recording', async () => {
    setLogSink(() => undefined);
    const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        const body = typeof init.body === 'string' ? init.body : '';
        sent.push({ url, headers: init.headers as Record<string, string>, body });
        const request = JSON.parse(body) as { messages: { content: string }[] };
        const data = /<data>\n([\s\S]*)\n<\/data>/u.exec(request.messages[0]?.content ?? '')?.[1] ?? '{}';
        const ids = (JSON.parse(data) as { candidates: { id: string }[] }).candidates.map(({ id }) => id);
        const text = JSON.stringify({
          scores: ids.map((candidateId) => ({ candidateId, score: 0.75, rationaleHint: 'close' })),
        });
        return Promise.resolve(
          new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 }),
        );
      }),
    );
    const written: { file: string; content: string }[] = [];
    const result = await recordByo(
      'anthropic',
      byoProvider('anthropic', KEY),
      (file, content) => written.push({ file, content }),
      () => '2026-10-12T10:00:00.000-04:00',
    );
    expect(result).toMatchObject({ answered: BENCH_INPUTS.length, asked: BENCH_INPUTS.length });
    expect(result.file.endsWith('bench/fixtures/intel/byo-anthropic.json')).toBe(true);
    expect(sent).toHaveLength(BENCH_INPUTS.length);
    for (const request of sent) {
      expect(request.url).toBe(BYO_VENDORS.anthropic.endpoint);
      expect(request.headers['x-api-key']).toBe(KEY);
      expect(request.body).not.toContain(KEY);
    }
    const [file] = written;
    expect(file?.content).not.toContain(KEY);
    expect(file?.content).not.toContain('close');
    const recording = IntelRecording.parse(JSON.parse(file?.content ?? ''));
    expect(recording).toMatchObject({ provider: 'byo', model: BYO_VENDORS.anthropic.model });
    expect(Object.keys(recording.answers)).toEqual(BENCH_INPUTS.map(({ hash }) => hash));
    expect(Object.values(recording.answers).every((scores) => scores?.[0]?.score === 7_500)).toBe(true);
  });

  it('writes null for an input the vendor did not answer', () => {
    const [first] = BENCH_INPUTS;
    if (first === undefined) throw new Error('no bench input');
    const recording = IntelRecording.parse(
      JSON.parse(byoRecording('openai', { [first.hash]: null }, '2026-10-12T10:00:00.000-04:00')),
    );
    expect(recording.answers[first.hash]).toBeNull();
    expect(recording.model).toBe(BYO_VENDORS.openai.model);
  });
});
