/**
 * Chrome's built-in on-device model as a provider (src/intel/providers/builtin.ts; sprint_5 5.2 done-when), over a
 * stand-in Prompt API (./stand-in.ts): its availability is read, never assumed (no API, each answer Chrome gives, a
 * check that fails); the ten check claims (entrypoints/model-check/inputs.ts) each produce parsed scores, every
 * session created with the constant system prompt and English, prompted with the input's data block, held to the
 * answer's JSON Schema, and destroyed; text that is not JSON, or no answer in time, gives no score. The JSON Schema
 * written out for Chrome says what `IntelOutput` says. Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CHECK_INPUTS } from '../../../entrypoints/model-check/inputs';
import { scoresFor } from '../../../src/intel';
import type { IntelInput } from '../../../src/intel/input';
import { dataBlock, SYSTEM_PROMPT } from '../../../src/intel/prompt';
import { builtinAvailability, builtinProvider, promptApi } from '../../../src/intel/providers/builtin';
import { INTEL_OUTPUT_JSON_SCHEMA, IntelOutput } from '../../../src/intel/schema';
import { type LogRecord, setLogSink } from '../../../src/log';
import { scoringAll, standIn } from './stand-in';

/** Check claim `n`'s input. */
function checkInput(n: number): IntelInput {
  const input = CHECK_INPUTS[n];
  if (input === undefined) throw new Error(`no check claim ${String(n)}`);
  return input;
}

/** The generated JSON Schema's parts the comparison reads, parsed rather than asserted. */
const Generated = z.object({
  required: z.array(z.string()),
  additionalProperties: z.boolean(),
  properties: z.object({
    scores: z.object({
      items: z.object({
        required: z.array(z.string()),
        additionalProperties: z.boolean(),
        properties: z.record(z.string(), z.record(z.string(), z.unknown())),
      }),
    }),
  }),
});

let records: LogRecord[];
let restore: () => void;
beforeEach(() => {
  records = [];
  restore = setLogSink((record) => records.push(record));
});
afterEach(() => {
  restore();
});

describe('the built-in model’s availability is read, never assumed', () => {
  it('is no_api where the context has no LanguageModel, or one without availability and create', async () => {
    expect(promptApi({})).toBeNull();
    expect(promptApi({ LanguageModel: { create: () => undefined } })).toBeNull();
    expect(await builtinAvailability(null)).toBe('no_api');
  });

  it.each(['unavailable', 'downloadable', 'downloading', 'available'] as const)(
    'is %s as Chrome says',
    async (said) => {
      const stand = standIn(said);
      expect(promptApi({ LanguageModel: stand.api })).toBe(stand.api);
      expect(await builtinAvailability(stand.api)).toBe(said);
    },
  );

  it('is unavailable when Chrome’s check fails', async () => {
    const failing = {
      ...standIn('available').api,
      availability: () => Promise.reject(new Error('no model')),
    };
    expect(await builtinAvailability(failing)).toBe('unavailable');
  });
});

describe('the built-in model scores the ten check claims', () => {
  it('gives each its parsed scores, each session with the system prompt, the data block and the schema, then destroyed', async () => {
    const stand = standIn('available');
    stand.answer = scoringAll(0.75);
    const provider = builtinProvider(stand.api);
    const scored = [];
    for (const input of CHECK_INPUTS) scored.push(await scoresFor(provider, input));
    expect(CHECK_INPUTS).toHaveLength(10);
    expect(scored.map((scores, i) => scores?.length === CHECK_INPUTS[i]?.candidates.length)).toEqual(
      Array.from({ length: 10 }, () => true),
    );
    expect(scored.flat().every((score) => score?.score === 7_500)).toBe(true);
    expect(stand.created).toHaveLength(10);
    expect(stand.created[0]).toMatchObject({
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
      expectedInputs: [{ type: 'text', languages: ['en'] }],
    });
    expect(stand.prompts).toEqual(CHECK_INPUTS.map(dataBlock));
    expect(stand.constraints.every((constraint) => constraint === INTEL_OUTPUT_JSON_SCHEMA)).toBe(true);
    expect(stand.destroyed).toBe(10);
    expect(records).toEqual([]);
  });

  it('gives no score for text that is not JSON, and none for no answer in time', async () => {
    const stand = standIn('available');
    const provider = builtinProvider(stand.api);
    stand.answer = () => Promise.resolve('Sure! The first candidate matches.');
    expect(await scoresFor(provider, checkInput(0))).toBeUndefined();
    stand.answer = (_prompt, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    expect(await scoresFor(provider, checkInput(1), 20)).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stand.destroyed).toBe(2);
    expect(records.map(({ event, fields }) => [event, fields.provider])).toEqual([
      ['intel.answer_invalid', 'builtin'],
      ['intel.timeout', 'builtin'],
    ]);
  });
});

describe('the answer’s JSON Schema, written out for Chrome', () => {
  it('says what IntelOutput says: the keys, what is required, nothing else, and the bounds', () => {
    const generated = Generated.parse(z.toJSONSchema(IntelOutput));
    const written = INTEL_OUTPUT_JSON_SCHEMA;
    expect([...written.required]).toEqual(generated.required);
    expect(written.additionalProperties).toBe(generated.additionalProperties);
    const items = generated.properties.scores.items;
    expect([...written.properties.scores.items.required]).toEqual(items.required);
    expect(written.properties.scores.items.additionalProperties).toBe(items.additionalProperties);
    expect(Object.keys(written.properties.scores.items.properties)).toEqual(Object.keys(items.properties));
    expect(written.properties.scores.items.properties.score).toMatchObject({
      minimum: items.properties.score?.minimum,
      maximum: items.properties.score?.maximum,
    });
    expect(written.properties.scores.items.properties.rationaleHint.maxLength).toBe(
      items.properties.rationaleHint?.maxLength,
    );
  });
});
