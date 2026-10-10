/**
 * Task 1.0: "every object schema strict" (Hard Rule 2). Walks every Zod schema src/core/schema.ts exports,
 * through every wrapper and container, and requires each object it reaches, nested ones included, to reject
 * unknown keys. A container kind the walker does not know fails the test instead of being skipped, so a new
 * wrapper cannot hide a non-strict object.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as core from '../../../src/core/schema';

/** Schema kinds with no child schema (Zod 4 `def.type`). */
const LEAF_KINDS: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'enum', 'literal', 'never']);

interface Walk {
  readonly objects: Set<z.ZodObject>;
  readonly unknownKinds: Set<string>;
}

function walk(schema: z.core.$ZodType, found: Walk): void {
  if (schema instanceof z.ZodObject) {
    if (found.objects.has(schema)) return;
    found.objects.add(schema);
    for (const field of Object.values<z.core.$ZodType>(schema.shape)) walk(field, found);
  } else if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    walk(schema.unwrap(), found);
  } else if (schema instanceof z.ZodArray) {
    walk(schema.element, found);
  } else if (schema instanceof z.ZodUnion) {
    for (const option of schema.options) walk(option, found);
  } else if (schema instanceof z.ZodRecord) {
    walk(schema.keyType, found);
    walk(schema.valueType, found);
  } else if (!LEAF_KINDS.has(schema._zod.def.type)) {
    found.unknownKinds.add(schema._zod.def.type);
  }
}

/** Every exported schema, plus the per-code Reason params schemas (a Map, so not a ZodType export). */
function walkExports(): Walk {
  const found: Walk = { objects: new Set(), unknownKinds: new Set() };
  for (const value of Object.values(core)) if (value instanceof z.ZodType) walk(value, found);
  for (const params of core.ReasonParams.values()) walk(params, found);
  return found;
}

describe('core schemas are strict everywhere', () => {
  it('reaches every object schema: no unknown container kind was skipped', () => {
    const { objects, unknownKinds } = walkExports();
    expect([...unknownKinds]).toEqual([]);
    // Request, Claim + extractor, Observation, ObserverCoverage, Coverage, HealthReport, Grant, GrantChoices (sprint_4
    // close), Reason, ReceiptOverride, Receipt + a reverted override, Attribution, GradeContext + scope, Activity + its
    // four element shapes, and one params object per ReasonCode (§15).
    expect(objects.size).toBe(21 + core.ReasonCode.options.length);
  });

  it('every object, nested ones included, rejects unknown keys', () => {
    const loose = [...walkExports().objects].filter((object) => !(object.def.catchall instanceof z.ZodNever));
    expect(loose.map((object) => Object.keys(object.shape).join(','))).toEqual([]);
  });

  it('detects a non-strict object (the walker is not vacuous)', () => {
    const found: Walk = { objects: new Set(), unknownKinds: new Set() };
    walk(z.strictObject({ inner: z.array(z.object({ smuggled: z.string() })).optional() }), found);
    const loose = [...found.objects].filter((object) => !(object.def.catchall instanceof z.ZodNever));
    expect(loose).toHaveLength(1);
    walk(
      z.string().transform((value) => value.length),
      found,
    );
    expect([...found.unknownKinds]).toEqual(['pipe']);
  });
});
