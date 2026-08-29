import { describe, expect, it } from "vitest";
import { DatabaseConfig, GraphNode } from "./graph.js";

describe("DatabaseConfig", () => {
  it("defaults to an in-memory database with empty SQL", () => {
    const cfg = DatabaseConfig.parse({});
    expect(cfg.path).toBeUndefined();
    expect(cfg.setupSql).toBe("");
    expect(cfg.sql).toBe("");
    expect(cfg.positionalParams).toBeUndefined();
    expect(cfg.namedParams).toBeUndefined();
  });

  it("parses a full config with file path, setup, and bound params", () => {
    const cfg = DatabaseConfig.parse({
      path: "/tmp/analytics.db",
      setupSql: "CREATE TABLE t (id INTEGER, name TEXT);",
      sql: "SELECT * FROM t WHERE id = ?",
      positionalParams: [7],
      namedParams: { min: 3 },
    });
    expect(cfg.path).toBe("/tmp/analytics.db");
    expect(cfg.setupSql).toContain("CREATE TABLE");
    expect(cfg.sql).toContain("SELECT");
    expect(cfg.positionalParams).toEqual([7]);
    expect(cfg.namedParams).toEqual({ min: 3 });
  });

  it("accepts named-params-only configs and keeps defaults for the rest", () => {
    const cfg = DatabaseConfig.parse({ sql: "SELECT * FROM t WHERE age >= :min", namedParams: { min: 18 } });
    expect(cfg.path).toBeUndefined();
    expect(cfg.setupSql).toBe("");
    expect(cfg.namedParams).toEqual({ min: 18 });
  });

  it("rejects non-string sql and non-array positional params", () => {
    expect(() => DatabaseConfig.parse({ sql: 42 })).toThrow();
    expect(() => DatabaseConfig.parse({ sql: "SELECT 1", positionalParams: "nope" })).toThrow();
    expect(() => DatabaseConfig.parse({ sql: "SELECT 1", namedParams: [] })).toThrow();
  });

  it("round-trips inside a GraphNode", () => {
    const node = GraphNode.parse({
      id: "db1",
      kind: "database",
      name: "QUERY",
      x: 0,
      y: 0,
      database: { path: ":memory:", setupSql: "CREATE TABLE t (x TEXT);", sql: "SELECT * FROM t" },
    });
    expect(node.kind).toBe("database");
    expect(node.database?.sql).toContain("SELECT");
  });
});
