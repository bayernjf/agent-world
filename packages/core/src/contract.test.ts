import { describe, expect, it } from "vitest";
import {
  coerceOutputObject,
  describeContractFailure,
  getPath,
  SCHEMA_VIOLATION,
  validateContract,
  type ContractSpec,
} from "./contract.js";

describe("validateContract", () => {
  it("passes when no contract is declared (backward compatible)", () => {
    expect(validateContract(null, { a: 1 })).toEqual({ ok: true });
    expect(validateContract({ requiredFields: [] }, "plain text")).toEqual({ ok: true });
  });

  it("reports missing required fields", () => {
    const c: ContractSpec = { requiredFields: ["title", "body"] };
    const r = validateContract(c, { title: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorCode).toBe(SCHEMA_VIOLATION);
      expect(r.missing).toEqual(["body"]);
    }
  });

  it("treats empty string, empty array and empty object as missing", () => {
    const c: ContractSpec = { requiredFields: ["s", "arr", "obj"] };
    const r = validateContract(c, { s: "   ", arr: [], obj: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["s", "arr", "obj"]);
  });

  it("resolves dot paths", () => {
    const c: ContractSpec = { requiredFields: ["meta.title"] };
    expect(validateContract(c, { meta: { title: "x" } }).ok).toBe(true);
    const r = validateContract(c, { meta: {} });
    expect(r.ok).toBe(false);
  });

  it("reports type mismatches", () => {
    const c: ContractSpec = { requiredFields: [], types: { count: "number", tags: "array", name: "string" } };
    const r = validateContract(c, { count: "3", tags: { x: 1 }, name: "ok" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = r.typeMismatches.map((m) => m.field).sort();
      expect(fields).toEqual(["count", "tags"]);
    }
  });

  it("parses JSON string output before validating", () => {
    const c: ContractSpec = { requiredFields: ["url"] };
    expect(validateContract(c, JSON.stringify({ url: "https://x" })).ok).toBe(true);
  });

  it("flags non-JSON text output as not an object", () => {
    const c: ContractSpec = { requiredFields: ["url"] };
    const r = validateContract(c, "just some prose, not json");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.notObject).toBe(true);
      expect(r.missing).toEqual(["url"]);
    }
  });

  it("does not double-report an absent field as a type mismatch", () => {
    const c: ContractSpec = { requiredFields: ["x"], types: { x: "number" } };
    const r = validateContract(c, {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toEqual(["x"]);
      expect(r.typeMismatches).toEqual([]);
    }
  });
});

describe("coerceOutputObject / getPath / describe", () => {
  it("coerces arrays and primitives to null", () => {
    expect(coerceOutputObject([1, 2])).toBeNull();
    expect(coerceOutputObject(42)).toBeNull();
    expect(coerceOutputObject(null)).toBeNull();
    expect(coerceOutputObject({ a: 1 })).toEqual({ a: 1 });
  });
  it("getPath walks objects safely", () => {
    expect(getPath({ a: { b: 2 } }, "a.b")).toBe(2);
    expect(getPath({ a: null }, "a.b")).toBeUndefined();
  });
  it("builds a readable failure reason", () => {
    const r = validateContract({ requiredFields: ["x"], types: { y: "number" } }, { y: "no" });
    if (!r.ok) {
      const msg = describeContractFailure(r);
      expect(msg).toContain("missing/empty fields: x");
      expect(msg).toContain("y expected number got string");
    }
  });
});
