import { describe, expect, it } from "vitest";
import { toPgPlaceholders } from "./pg-sql.js";

describe("toPgPlaceholders", () => {
  it("rewrites ? to $1, $2 in order", () => {
    expect(toPgPlaceholders("SELECT * FROM t WHERE a = ? AND b = ?")).toBe(
      "SELECT * FROM t WHERE a = $1 AND b = $2",
    );
  });

  it("skips ? inside single-quoted string literals", () => {
    expect(toPgPlaceholders("SELECT '?' AS q WHERE a = ?")).toBe(
      "SELECT '?' AS q WHERE a = $1",
    );
  });

  it("keeps doubled '' escapes intact and skips ? inside them", () => {
    expect(toPgPlaceholders("INSERT INTO t (v) VALUES ('it''s ?', ?)")).toBe(
      "INSERT INTO t (v) VALUES ('it''s ?', $1)",
    );
  });

  it("returns the input unchanged when there are no placeholders", () => {
    expect(toPgPlaceholders("SELECT 1")).toBe("SELECT 1");
  });

  it("numbers placeholders sequentially across the whole statement", () => {
    expect(toPgPlaceholders("INSERT INTO t VALUES (?, ?, ?)")).toBe(
      "INSERT INTO t VALUES ($1, $2, $3)",
    );
  });
});
