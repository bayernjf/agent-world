/**
 * Upstream data-contract guard (competitor painpoint G2).
 *
 * A source node (HTTP / database / file / manual material bench) can declare a
 * `ContractSpec`; after the node produces output and BEFORE it flows downstream,
 * `validateContract` checks it deterministically. A missing required field, wrong
 * type, or empty value fails the node up front (error code SCHEMA_VIOLATION)
 * instead of letting garbage silently reach an LLM node that then emits a
 * plausible-looking wrong result.
 *
 * Two root shapes are supported:
 * - `root: "object"` (default, legacy): validate `requiredFields` / `types`
 *   against the output object.
 * - `root: "array"`: the output is a list of rows (a connector's Product[] /
 *   SQL rows). The root must be a non-empty array and every element is checked
 *   against `items.requiredFields` / `items.types`. Element violations are
 *   reported with an index path (`[0].name`). This is G2.4's restart
 *   prerequisite (A): array contracts for structured data-source payloads.
 *
 * This module is the pure, engine-agnostic core (G2.1). Wiring it into the
 * engine (G2.2) and the Inspector form (G2.3) are separate steps.
 */

import { z } from "zod";

export const CONTRACT_FIELD_TYPES = ["string", "number", "boolean", "array", "object"] as const;
export type ContractFieldType = (typeof CONTRACT_FIELD_TYPES)[number];

/** Per-element assertions for an array-root contract. */
export interface ContractItemSpec {
  /** Field paths that must be present and non-empty on every element. Dot paths supported. */
  requiredFields?: string[];
  /** Optional per-field type assertions applied to every element. */
  types?: Partial<Record<string, ContractFieldType>>;
}

export interface ContractSpec {
  /**
   * Shape of the validated root. Defaults to "object" (fully backward
   * compatible with specs persisted before array contracts existed).
   */
  root?: "object" | "array";
  /** Object-root field paths that must be present and non-empty. Dot paths (a.b) supported. */
  requiredFields?: string[];
  /** Object-root optional per-field type assertions. */
  types?: Partial<Record<string, ContractFieldType>>;
  /** Array-root assertions applied to every element. */
  items?: ContractItemSpec;
  /** Array-root minimum element count. Defaults to 1 when `root` is "array". */
  minItems?: number;
}

const ItemSpecSchema = z.object({
  requiredFields: z.array(z.string()).default([]),
  types: z.record(z.enum(CONTRACT_FIELD_TYPES)).optional(),
});

/**
 * Persistence/validation schema for a contract spec carried on a graph node
 * (G2.3 Inspector form). Kept in lockstep with the {@link ContractSpec}
 * interface used by the pure validator.
 */
export const ContractSpecSchema = z.object({
  root: z.enum(["object", "array"]).optional(),
  requiredFields: z.array(z.string()).default([]),
  types: z.record(z.enum(CONTRACT_FIELD_TYPES)).optional(),
  items: ItemSpecSchema.optional(),
  minItems: z.number().int().nonnegative().optional(),
});

export const SCHEMA_VIOLATION = "SCHEMA_VIOLATION" as const;

/** Cap on per-element violations reported for one array, to keep logs bounded. */
const MAX_ARRAY_VIOLATIONS = 20;

export type ContractResult =
  | { ok: true }
  | {
      ok: false;
      errorCode: typeof SCHEMA_VIOLATION;
      /** Output could not be interpreted as the expected root shape at all. */
      notObject: boolean;
      /** Which root shape was expected (drives the failure wording). */
      shapeExpected?: "object" | "array";
      /** Array-root: the list had fewer than `minItems` elements. */
      emptyArray?: boolean;
      /** Required fields that were absent or empty (`[i].field` for array elements). */
      missing: string[];
      /** Fields present but with the wrong runtime type. */
      typeMismatches: Array<{ field: string; expected: ContractFieldType; actual: string }>;
    };

function actualType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function matchesType(v: unknown, expected: ContractFieldType): boolean {
  switch (expected) {
    case "array":
      return Array.isArray(v);
    case "object":
      return typeof v === "object" && v !== null && !Array.isArray(v);
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "string":
      return typeof v === "string";
  }
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Resolve a dot path (a.b.c) against an object; returns undefined if absent. */
export function getPath(obj: unknown, path: string): unknown {
  if (obj == null || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Coerce a node's output (string or structured) into the object a contract
 * validates against. JSON strings are parsed; plain (non-JSON) text, null,
 * primitives or arrays yield `null` (signalling "not an object").
 */
export function coerceOutputObject(output: unknown): Record<string, unknown> | null {
  if (output == null) return null;
  if (isPlainObject(output)) {
    return output;
  }
  if (typeof output === "string") {
    const trimmed = output.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (isPlainObject(parsed)) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Coerce a node's output into the array an array-root contract validates
 * against. Accepts a real array or a JSON string whose top level is an array;
 * anything else (object, non-JSON text, null) yields `null`.
 */
export function coerceOutputArray(output: unknown): unknown[] | null {
  if (Array.isArray(output)) return output;
  if (typeof output === "string") {
    const trimmed = output.trim();
    if (!trimmed.startsWith("[")) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Validate node output against an optional contract.
 *
 * - No contract / empty assertions → always passes (fully backward compatible
 *   with existing nodes that declare nothing).
 * - `root: "object"` (default): declared fields missing/empty or mistyped fail.
 * - `root: "array"`: root must be a non-empty array; each element's declared
 *   fields are checked, violations reported as `[i].field`.
 */
export function validateContract(contract: ContractSpec | null | undefined, output: unknown): ContractResult {
  if (!contract) return { ok: true };
  if (contract.root === "array") return validateArrayContract(contract, output);

  const required = contract.requiredFields ?? [];
  const types = contract.types ?? {};
  const hasAssertions = required.length > 0 || Object.keys(types).length > 0;
  if (!hasAssertions) return { ok: true };

  const obj = coerceOutputObject(output);
  if (obj == null) {
    // Type assertions against a non-object are all mismatches; required fields
    // are all missing.
    const typeMismatches = Object.entries(types).map(([field, expected]) => ({
      field,
      expected: expected as ContractFieldType,
      actual: actualType(output),
    }));
    return {
      ok: false,
      errorCode: SCHEMA_VIOLATION,
      notObject: true,
      shapeExpected: "object",
      missing: [...required],
      typeMismatches,
    };
  }

  const missing: string[] = [];
  for (const field of required) {
    if (isEmpty(getPath(obj, field))) missing.push(field);
  }

  const typeMismatches: Array<{ field: string; expected: ContractFieldType; actual: string }> = [];
  for (const [field, expected] of Object.entries(types)) {
    if (!expected) continue;
    const v = getPath(obj, field);
    if (v === undefined) continue; // absence is reported as `missing`, not type
    if (!matchesType(v, expected)) {
      typeMismatches.push({ field, expected, actual: actualType(v) });
    }
  }

  if (missing.length === 0 && typeMismatches.length === 0) return { ok: true };
  return {
    ok: false,
    errorCode: SCHEMA_VIOLATION,
    notObject: false,
    shapeExpected: "object",
    missing,
    typeMismatches,
  };
}

/** Array-root validation (G2.4 prerequisite A). See {@link validateContract}. */
function validateArrayContract(contract: ContractSpec, output: unknown): ContractResult {
  const minItems = contract.minItems ?? 1;
  const itemRequired = contract.items?.requiredFields ?? [];
  const itemTypes = contract.items?.types ?? {};

  const arr = coerceOutputArray(output);
  if (arr == null) {
    const typeMismatches = Object.entries(itemTypes).map(([field, expected]) => ({
      field,
      expected: expected as ContractFieldType,
      actual: actualType(output),
    }));
    return {
      ok: false,
      errorCode: SCHEMA_VIOLATION,
      notObject: true,
      shapeExpected: "array",
      emptyArray: false,
      missing: [...itemRequired],
      typeMismatches,
    };
  }

  if (arr.length < minItems) {
    return {
      ok: false,
      errorCode: SCHEMA_VIOLATION,
      notObject: false,
      shapeExpected: "array",
      emptyArray: true,
      missing: [],
      typeMismatches: [],
    };
  }

  const checksItemShape = itemRequired.length > 0 || Object.keys(itemTypes).length > 0;
  const missing: string[] = [];
  const typeMismatches: Array<{ field: string; expected: ContractFieldType; actual: string }> = [];
  let reported = 0;

  for (let i = 0; i < arr.length; i++) {
    if (reported >= MAX_ARRAY_VIOLATIONS) break;
    const el = arr[i];
    const idx = `[${i}]`;
    if (!isPlainObject(el)) {
      // A non-object element cannot carry any declared field; report it once.
      if (checksItemShape) {
        typeMismatches.push({ field: idx, expected: "object", actual: actualType(el) });
        reported++;
      }
      continue;
    }
    for (const field of itemRequired) {
      if (reported >= MAX_ARRAY_VIOLATIONS) break;
      if (isEmpty(getPath(el, field))) {
        missing.push(`${idx}.${field}`);
        reported++;
      }
    }
    for (const [field, expected] of Object.entries(itemTypes)) {
      if (reported >= MAX_ARRAY_VIOLATIONS) break;
      if (!expected) continue;
      const v = getPath(el, field);
      if (v === undefined) continue; // absence is reported as `missing`, not type
      if (!matchesType(v, expected)) {
        typeMismatches.push({ field: `${idx}.${field}`, expected, actual: actualType(v) });
        reported++;
      }
    }
  }

  if (missing.length === 0 && typeMismatches.length === 0) return { ok: true };
  return {
    ok: false,
    errorCode: SCHEMA_VIOLATION,
    notObject: false,
    shapeExpected: "array",
    emptyArray: false,
    missing,
    typeMismatches,
  };
}

/** Human-readable one-line reason for a contract failure, for logs / UI. */
export function describeContractFailure(r: Extract<ContractResult, { ok: false }>): string {
  const parts: string[] = [];
  if (r.notObject) {
    parts.push(r.shapeExpected === "array" ? "output is not a JSON array" : "output is not a JSON object");
  }
  if (r.emptyArray) parts.push("array has fewer than the required item(s)");
  if (r.missing.length) parts.push(`missing/empty fields: ${r.missing.join(", ")}`);
  if (r.typeMismatches.length) {
    parts.push(
      `type mismatches: ${r.typeMismatches.map((m) => `${m.field} expected ${m.expected} got ${m.actual}`).join("; ")}`,
    );
  }
  return parts.join("; ");
}
