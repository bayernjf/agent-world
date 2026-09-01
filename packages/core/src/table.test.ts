import { describe, expect, it } from "vitest";
import {
  aggregateRows,
  applyTableSteps,
  collectColumns,
  filterRows,
  parseCsv,
  parseJsonRows,
  rowsToCsv,
  sortRows,
  tableInputFrom,
} from "./table.js";
import type { TableRow } from "./graph.js";

const csv = "name,age,city\nAlice,30,Shanghai\nBob,25,Beijing\nCarol,35,Shanghai";

describe("parseCsv", () => {
  it("parses a header row into objects with typed cells", () => {
    const rows = parseCsv(csv);
    expect(rows).toEqual([
      { name: "Alice", age: 30, city: "Shanghai" },
      { name: "Bob", age: 25, city: "Beijing" },
      { name: "Carol", age: 35, city: "Shanghai" },
    ]);
  });

  it("handles quoted fields with embedded delimiters and newlines", () => {
    const rows = parseCsv('a,b\n"x,y",1\n"line1\nline2",2');
    expect(rows).toEqual([
      { a: "x,y", b: 1 },
      { a: "line1\nline2", b: 2 },
    ]);
  });

  it("supports escaped quotes", () => {
    const rows = parseCsv('a\n"say ""hi"""');
    expect(rows).toEqual([{ a: 'say "hi"' }]);
  });

  it("supports headerless input with columnN names", () => {
    const rows = parseCsv("1,2\n3,4", { hasHeader: false });
    expect(rows).toEqual([
      { column1: 1, column2: 2 },
      { column1: 3, column2: 4 },
    ]);
  });

  it("supports a custom delimiter", () => {
    const rows = parseCsv("a\tb\n1\t2", { delimiter: "\t" });
    expect(rows).toEqual([{ a: 1, b: 2 }]);
  });

  it("coerces booleans and nulls", () => {
    const rows = parseCsv("flag,note\ntrue,\nfalse,ok");
    expect(rows).toEqual([
      { flag: true, note: null },
      { flag: false, note: "ok" },
    ]);
  });
});

describe("rowsToCsv", () => {
  it("round-trips a parsed table", () => {
    const rows = parseCsv(csv);
    expect(parseCsv(rowsToCsv(rows))).toEqual(rows);
  });

  it("quotes fields that need it", () => {
    expect(rowsToCsv([{ a: "x,y", b: 'say "hi"' }])).toBe('a,b\n"x,y","say ""hi"""');
  });

  it("fills missing cells with empty strings", () => {
    expect(rowsToCsv([{ a: 1 }, { a: 2, b: "x" }])).toBe("a,b\n1,\n2,x");
  });
});

describe("filterRows", () => {
  const rows = parseCsv(csv);

  it("filters with numeric gt", () => {
    const out = filterRows(rows, { op: "filter", column: "age", operator: "gt", value: "27" });
    expect(out.map((r) => r.name)).toEqual(["Alice", "Carol"]);
  });

  it("filters with string eq and ne", () => {
    expect(filterRows(rows, { op: "filter", column: "city", operator: "eq", value: "Shanghai" }).length).toBe(2);
    expect(filterRows(rows, { op: "filter", column: "city", operator: "ne", value: "Shanghai" }).length).toBe(1);
  });

  it("filters with contains (case-insensitive)", () => {
    const out = filterRows(rows, { op: "filter", column: "name", operator: "contains", value: "a" });
    expect(out.map((r) => r.name)).toEqual(["Alice", "Carol"]);
  });

  it("treats a missing column as null (eq '' matches every null cell)", () => {
    const out = filterRows(rows, { op: "filter", column: "missing", operator: "eq", value: "" });
    expect(out.length).toBe(3);
  });
});

describe("sortRows", () => {
  const rows = parseCsv(csv);

  it("sorts ascending by a numeric column", () => {
    const out = sortRows(rows, { op: "sort", column: "age", direction: "asc" });
    expect(out.map((r) => r.name)).toEqual(["Bob", "Alice", "Carol"]);
  });

  it("sorts descending by a string column (stable for ties)", () => {
    const out = sortRows(rows, { op: "sort", column: "city", direction: "desc" });
    expect(out.map((r) => r.name)).toEqual(["Alice", "Carol", "Bob"]);
  });

  it("does not mutate the input", () => {
    const before = JSON.stringify(rows);
    sortRows(rows, { op: "sort", column: "age", direction: "desc" });
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("sinks missing cells to the bottom regardless of direction (dogfood tpl-evidence-brief)", () => {
    const withGaps = [
      { name: "empty-string", age: "" },
      { name: "young", age: 20 },
      { name: "null", age: null },
      { name: "old", age: 60 },
      { name: "absent" },
    ];
    const asc = sortRows(withGaps, { op: "sort", column: "age", direction: "asc" });
    expect(asc.map((r) => r.name)).toEqual(["young", "old", "empty-string", "null", "absent"]);
    const desc = sortRows(withGaps, { op: "sort", column: "age", direction: "desc" });
    expect(desc.map((r) => r.name)).toEqual(["old", "young", "empty-string", "null", "absent"]);
  });
});

describe("aggregateRows", () => {
  const rows = parseCsv(csv);

  it("counts per group", () => {
    const out = aggregateRows(rows, {
      op: "aggregate",
      groupBy: "city",
      aggs: [{ column: "name", fn: "count", as: "people" }],
    });
    expect(out).toEqual([
      { city: "Shanghai", people: 2 },
      { city: "Beijing", people: 1 },
    ]);
  });

  it("aggregates the whole table without groupBy", () => {
    const out = aggregateRows(rows, {
      op: "aggregate",
      aggs: [{ column: "age", fn: "avg", as: "avg_age" }, { column: "age", fn: "max" }],
    });
    expect(out).toEqual([{ avg_age: 30, max_age: 35 }]);
  });

  it("sums only numeric cells", () => {
    const out = aggregateRows(rows, { op: "aggregate", aggs: [{ column: "name", fn: "sum" }] });
    expect(out).toEqual([{ sum_name: null }]);
  });
});

describe("tableInputFrom", () => {
  it("accepts an array of row objects", () => {
    const { rows } = tableInputFrom([{ a: 1 }, { a: "2", b: true }]);
    expect(rows).toEqual([{ a: 1 }, { a: 2, b: true }]);
  });

  it("accepts a { rows } wrapper", () => {
    const { rows } = tableInputFrom({ rows: [{ a: 1 }] });
    expect(rows).toEqual([{ a: 1 }]);
  });

  it("treats a string as text input", () => {
    const input = tableInputFrom("a,b\n1,2");
    expect("text" in input).toBe(true);
  });

  it("rejects unsupported shapes", () => {
    expect(() => tableInputFrom(42)).toThrow(/数组/);
    expect(() => tableInputFrom({ rows: "nope" })).toThrow(/rows 数组/);
  });
});

describe("applyTableSteps", () => {
  it("parses CSV then filters and sorts", () => {
    const { rows } = applyTableSteps({ text: csv }, [
      { op: "parse", format: "csv", hasHeader: true, delimiter: "," },
      { op: "filter", column: "age", operator: "gte", value: "28" },
      { op: "sort", column: "age", direction: "desc" },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Carol", "Alice"]);
  });

  it("works on a rows input without a parse step", () => {
    const { rows } = applyTableSteps({ rows: [{ a: 2 }, { a: 1 }, { a: 3 }] }, [
      { op: "sort", column: "a", direction: "asc" },
    ]);
    expect(rows.map((r) => r.a)).toEqual([1, 2, 3]);
  });

  it("parses JSON rows with the json format", () => {
    const { rows } = applyTableSteps({ text: '[{"a":1},{"a":2}]' }, [
      { op: "parse", format: "json", hasHeader: true, delimiter: "," },
    ]);
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("honours the output step", () => {
    const r = applyTableSteps({ text: csv }, [{ op: "parse", format: "csv" }, { op: "output", format: "csv" }]);
    expect(r.output).toBe("csv");
  });

  it("throws when parse has no text input", () => {
    expect(() =>
      applyTableSteps({ rows: [{ a: 1 }] }, [{ op: "parse", format: "csv", hasHeader: true, delimiter: "," }]),
    ).toThrow(/parse 步骤/);
  });
});

describe("collectColumns", () => {
  it("unions columns in first-seen order", () => {
    const rows: TableRow[] = [{ a: 1, b: 2 }, { b: 3, c: 4 }];
    expect(collectColumns(rows)).toEqual(["a", "b", "c"]);
  });
});

describe("parseJsonRows", () => {
  it("parses a JSON array of objects", () => {
    expect(parseJsonRows('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJsonRows("not json")).toThrow(/JSON/);
  });
});
