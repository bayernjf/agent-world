import { describe, it, expect } from "vitest";
import { billingReturnPath, parseBillingReturn, BILLING_RETURN_KEY } from "./billingReturn";

describe("parseBillingReturn", () => {
  it("parses each known marker", () => {
    expect(parseBillingReturn("?billing=success")).toBe("success");
    expect(parseBillingReturn("?billing=cancel")).toBe("cancel");
    expect(parseBillingReturn("?billing=manage-done")).toBe("manage-done");
  });

  it("works without a leading question mark", () => {
    expect(parseBillingReturn("billing=success")).toBe("success");
  });

  it("tolerates other unrelated query params", () => {
    expect(parseBillingReturn("?foo=1&billing=cancel&bar=2")).toBe("cancel");
  });

  it("returns null for a missing/empty marker", () => {
    expect(parseBillingReturn("")).toBeNull();
    expect(parseBillingReturn("?foo=1")).toBeNull();
  });

  it("returns null for an unknown marker (no arbitrary toast injection)", () => {
    expect(parseBillingReturn("?billing=evil")).toBeNull();
    expect(parseBillingReturn("?billing=SUCCESS")).toBeNull(); // case-sensitive
  });

  it("takes the first value when the key repeats", () => {
    expect(parseBillingReturn("?billing=success&billing=cancel")).toBe("success");
  });
});

describe("billingReturnPath", () => {
  it("builds the same-origin relative path", () => {
    expect(billingReturnPath("success")).toBe(`/?${BILLING_RETURN_KEY}=success`);
    expect(billingReturnPath("cancel")).toBe("/?billing=cancel");
  });
});
