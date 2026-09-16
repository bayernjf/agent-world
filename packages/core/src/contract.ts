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
 * This module is the pure, engine-agnostic core (G2.1). Wiring it into the
 * engine (G2.2) and the Inspector form (G2.3) are separate steps.
 */

import { z } from "zod";

export const CONTRACT_FIELD_TYPES = ["string", "number", "boolean", "array", "object"] as const;
export type ContractFieldType = (typeof CONTRACT_FIELD_TYPES)[number];

export interface ContractSpec {
  /** Field paths that must be present and non-empty. Dot paths (a.b) supported. */
  requiredFields: string[];
  /** Optional per-field type assertions. */
  types?: Partial<Record<string, ContractFieldType>>;
}

/**
 * Persistence/validation schema for a contract spec carried on a graph node
 * (G2.3 Inspector form). Kept in lockstep with the {@link ContractSpec}
 * interface used by the pure validator.
 */
export const ContractSpecSchema = z.object({
  requiredFields: z.array(z.string()).default([]),
  types: z.record(z.enum(CONTRACT_FIELD_TYPES)).optional(),
});

export const SCHEMA_VIOLATION = "SCHEMA_VIOLATION" as const;

export type ContractResult =
  | { ok: true }
  | {
      ok: false;
      errorCode: typeof SCHEMA_VIOLATION;
      /** Output could not be interpreted as the expected object at all. */
      notObject: boolean;
      /** Required fields that were absent or empty. */
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
 * validates against. JSON strings are parsed; plain (non-JSON) text, null or
 * primitives yield `null` (signalling "not an object").
 */
export function coerceOutputObject(output: unknown): Record<string, unknown> | null {
  if (output == null) return null;
  if (typeof output === "object" && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }
  if (typeof output === "string") {
    const trimmed = output.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Validate node output against an optional contract.
 *
 * - No contract / empty requiredFields and no type assertions → always passes
 *   (fully backward compatible with existing nodes that declare nothing).
 * - Declared fields that are missing/empty or mistyped fail deterministically.
 */
export function validateContract(contract: ContractSpec | null | undefined, output: unknown): ContractResult {
  const required = contract?.requiredFields ?? [];
  const types = contract?.types ?? {};
  const hasAssertions = required.length > 0 || Object.keys(types).length > 0;
  if (!contract || !hasAssertions) return { ok: true };

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
  return { ok: false, errorCode: SCHEMA_VIOLATION, notObject: false, missing, typeMismatches };
}

/** Human-readable one-line reason for a contract failure, for logs / UI. */
export function describeContractFailure(r: Extract<ContractResult, { ok: false }>): string {
  const parts: string[] = [];
  if (r.notObject) parts.push("output is not a JSON object");
  if (r.missing.length) parts.push(`missing/empty fields: ${r.missing.join(", ")}`);
  if (r.typeMismatches.length) {
    parts.push(
      `type mismatches: ${r.typeMismatches.map((m) => `${m.field} expected ${m.expected} got ${m.actual}`).join("; ")}`,
    );
  }
  return parts.join("; ");
}
