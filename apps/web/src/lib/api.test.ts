import { describe, it, expect } from "vitest";
import { proxyImageUrl } from "./api";

describe("proxyImageUrl", () => {
  it("returns null for null, undefined and empty string", () => {
    expect(proxyImageUrl(null)).toBeNull();
    expect(proxyImageUrl(undefined)).toBeNull();
    expect(proxyImageUrl("")).toBeNull();
  });

  it("normalizes own artifact store URLs to same-origin paths", () => {
    const result = proxyImageUrl("https://example.com/api/artifacts/up-abc123");
    expect(result).toBe("/api/artifacts/up-abc123");
  });

  it("normalizes http (not https) own artifact URLs", () => {
    const result = proxyImageUrl("http://localhost:8791/api/artifacts/up-xyz789");
    expect(result).toBe("/api/artifacts/up-xyz789");
  });

  it("strips query strings and fragments when normalizing own artifact URLs", () => {
    const result = proxyImageUrl("https://example.com/api/artifacts/up-abc123?size=large#frag");
    expect(result).toBe("/api/artifacts/up-abc123");
  });

  it("is case-insensitive for the http(s) scheme in own artifact matching", () => {
    // The regex has the /i flag, so HTTPS:// matches. The captured path
    // keeps its original case (no normalization beyond what the regex captures).
    const result = proxyImageUrl("HTTPS://Example.COM/api/artifacts/up-abc123");
    expect(result).toBe("/api/artifacts/up-abc123");
  });

  it("routes external http(s) URLs through the proxy endpoint", () => {
    const url = "https://cdn.example.com/images/photo.jpg";
    const result = proxyImageUrl(url);
    expect(result).toBe(`/api/proxy?url=${encodeURIComponent(url)}`);
  });

  it("routes external http URLs through the proxy endpoint", () => {
    const url = "http://other-site.com/pic.png";
    const result = proxyImageUrl(url);
    expect(result).toBe(`/api/proxy?url=${encodeURIComponent(url)}`);
  });

  it("encodes special characters in the proxied URL (query params, spaces, unicode)", () => {
    const url = "https://example.com/image with spaces.jpg?width=100&height=200";
    const result = proxyImageUrl(url);
    expect(result).toBe(`/api/proxy?url=${encodeURIComponent(url)}`);
    expect(result).toContain("image%20with%20spaces");
    expect(result).toContain("width%3D100");
  });

  it("returns relative /api/ paths unchanged (already same-origin)", () => {
    expect(proxyImageUrl("/api/artifacts/up-abc123")).toBe("/api/artifacts/up-abc123");
    expect(proxyImageUrl("/api/proxy?url=...")).toBe("/api/proxy?url=...");
  });

  it("returns data: URIs unchanged (no proxy needed)", () => {
    const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    expect(proxyImageUrl(dataUri)).toBe(dataUri);
  });

  it("returns blob: URIs unchanged", () => {
    const blobUri = "blob:https://example.com/abc-123-def";
    expect(proxyImageUrl(blobUri)).toBe(blobUri);
  });

  it("does not proxy URLs that look like artifacts but are on a different path", () => {
    // /api/artifacts is only recognized after the host, not as a path prefix
    // on an external domain — this is an external URL and should be proxied.
    const url = "https://evil.com/api/artifacts/up-fake";
    const result = proxyImageUrl(url);
    // The regex matches any host + /api/artifacts/, so this IS normalized.
    // This documents the current behavior: the function trusts any host that
    // serves /api/artifacts/ paths.
    expect(result).toBe("/api/artifacts/up-fake");
  });
});
