import { describe, expect, it } from "vitest";
import { GraphNode } from "./graph.js";
import {
  coerceOutputArray,
  coerceOutputObject,
  ContractSpecSchema,
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

describe("ContractSpecSchema (G2.3 persistence)", () => {
  it("parses a full spec and its output satisfies the ContractSpec type", () => {
    const parsed = ContractSpecSchema.parse({
      requiredFields: ["title", "meta.count"],
      types: { title: "string", "meta.count": "number", tags: "array" },
    });
    expect(parsed.requiredFields).toEqual(["title", "meta.count"]);
    expect(parsed.types?.tags).toBe("array");
    // The parsed value must be directly usable by the pure validator.
    const spec: ContractSpec = parsed;
    expect(validateContract(spec, { title: "hi", meta: { count: 2 }, tags: [] }).ok).toBe(true);
  });

  it("defaults requiredFields to an empty array when omitted", () => {
    const parsed = ContractSpecSchema.parse({});
    expect(parsed.requiredFields).toEqual([]);
    expect(parsed.types).toBeUndefined();
  });

  it("rejects an unknown field type", () => {
    expect(() =>
      ContractSpecSchema.parse({ requiredFields: ["a"], types: { a: "datetime" } }),
    ).toThrow();
  });
});

describe("GraphNode.contract (top-level optional field)", () => {
  const baseNode = { id: "A", kind: "textGen", name: "A", x: 0, y: 0 };

  it("accepts a legacy node without a contract (backward compatible)", () => {
    expect(GraphNode.safeParse(baseNode).success).toBe(true);
  });

  it("accepts a node carrying a contract spec", () => {
    const parsed = GraphNode.parse({
      ...baseNode,
      kind: "http",
      contract: { requiredFields: ["url"], types: { count: "number" } },
    });
    expect(parsed.contract?.requiredFields).toEqual(["url"]);
    expect(parsed.contract?.types?.count).toBe("number");
  });
});

describe("array-root contracts (G2.4 prerequisite A)", () => {
  const rows = [
    { name: "Widget", price: 9.9, sku: "W-1" },
    { name: "Gadget", price: 19, sku: "G-2" },
  ];

  it("passes a well-formed array whose elements satisfy items", () => {
    const c: ContractSpec = { root: "array", items: { requiredFields: ["name", "price"] } };
    expect(validateContract(c, rows).ok).toBe(true);
  });

  it("with no items only asserts a non-empty array", () => {
    expect(validateContract({ root: "array" }, [1, 2, 3]).ok).toBe(true);
    expect(validateContract({ root: "array" }, [{ a: 1 }, "x"]).ok).toBe(true);
  });

  it("parses a JSON array string before validating", () => {
    const c: ContractSpec = { root: "array", items: { requiredFields: ["name"] } };
    expect(validateContract(c, JSON.stringify(rows)).ok).toBe(true);
  });

  it("fails when the root is an object instead of an array", () => {
    const c: ContractSpec = { root: "array", items: { requiredFields: ["name"] } };
    const r = validateContract(c, { name: "solo" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.notObject).toBe(true);
      expect(r.shapeExpected).toBe("array");
      expect(r.missing).toEqual(["name"]);
      expect(describeContractFailure(r)).toContain("not a JSON array");
    }
  });

  it("fails non-JSON text as not-an-array", () => {
    const c: ContractSpec = { root: "array", items: { requiredFields: ["name"] } };
    const r = validateContract(c, "a source brief in plain markdown");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.notObject).toBe(true);
  });

  it("fails an empty array (default minItems 1) with emptyArray", () => {
    const c: ContractSpec = { root: "array", items: { requiredFields: ["name"] } };
    const r = validateContract(c, []);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.emptyArray).toBe(true);
      expect(describeContractFailure(r)).toContain("fewer than the required item");
    }
  });

  it("honours an explicit minItems of 0 (empty array allowed)", () => {
    expect(validateContract({ root: "array", minItems: 0 }, []).ok).toBe(true);
  });

  it("reports a missing element field with an index path", () => {
    const c: ContractSpec = { root: "array", items: { requiredFields: ["name", "price"] } };
    const r = validateContract(c, [{ name: "Widget", price: 1 }, { name: "NoPrice" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["[1].price"]);
  });

  it("reports an element type mismatch with an index path", () => {
    const c: ContractSpec = { root: "array", items: { types: { price: "number" } } };
    const r = validateContract(c, [{ price: 1 }, { price: "free" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.typeMismatches).toEqual([{ field: "[1].price", expected: "number", actual: "string" }]);
    }
  });

  it("reports a non-object element once as an object mismatch", () => {
    const c: ContractSpec = { root: "array", items: { requiredFields: ["name"] } };
    const r = validateContract(c, [{ name: "ok" }, "bare-string", 42]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.typeMismatches).toEqual([
        { field: "[1]", expected: "object", actual: "string" },
        { field: "[2]", expected: "object", actual: "number" },
      ]);
    }
  });

  it("resolves dot paths inside each element", () => {
    const c: ContractSpec = { root: "array", items: { requiredFields: ["meta.sku"] } };
    expect(validateContract(c, [{ meta: { sku: "X" } }]).ok).toBe(true);
    const r = validateContract(c, [{ meta: {} }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["[0].meta.sku"]);
  });
});

describe("coerceOutputArray", () => {
  it("passes arrays through and parses JSON array strings", () => {
    expect(coerceOutputArray([1, 2])).toEqual([1, 2]);
    expect(coerceOutputArray('[{"a":1}]')).toEqual([{ a: 1 }]);
  });
  it("returns null for objects, JSON objects, non-array text and null", () => {
    expect(coerceOutputArray({ a: 1 })).toBeNull();
    expect(coerceOutputArray('{"a":1}')).toBeNull();
    expect(coerceOutputArray("nope")).toBeNull();
    expect(coerceOutputArray(null)).toBeNull();
  });
});

describe("ContractSpecSchema array persistence", () => {
  it("parses an array spec with items and minItems", () => {
    const parsed = ContractSpecSchema.parse({
      root: "array",
      items: { requiredFields: ["name", "price"], types: { price: "number" } },
      minItems: 1,
    });
    expect(parsed.root).toBe("array");
    expect(parsed.items?.requiredFields).toEqual(["name", "price"]);
    expect(parsed.items?.types?.price).toBe("number");
    const spec: ContractSpec = parsed;
    expect(validateContract(spec, [{ name: "W", price: 1 }]).ok).toBe(true);
  });

  it("defaults root to object and items to undefined (backward compatible)", () => {
    const parsed = ContractSpecSchema.parse({ requiredFields: ["a"] });
    expect(parsed.root).toBe("object");
    expect(parsed.items).toBeUndefined();
  });

  it("rejects an unknown root shape", () => {
    expect(() => ContractSpecSchema.parse({ root: "table" })).toThrow();
  });
});
