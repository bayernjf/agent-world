import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";
import i18n from "../i18n";

// waitFor / findBy* default to a 1000ms async-util timeout. Under vitest's
// multi-worker parallelism (or a loaded CI runner) mocked promises and React
// effects occasionally take longer than 1s to flush, causing load-only flakes
// where a panel stayed on "加载中…" while isolated and sequential runs were
// always green. Raise the global async-assertion budget to 5s (matches the
// per-file wrapper some suites already use); kept well below the 10s
// testTimeout so a genuinely stuck test still fails the test first.
configure({ asyncUtilTimeout: 5000 });

// Force Chinese language in tests to match existing test assertions
i18n.changeLanguage("zh");

// ResizeObserver mock (components use it for size tracking)
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverMock;

// IntersectionObserver mock (lazy loading, infinite scroll)
class IntersectionObserverMock {
  readonly root: Element | null = null;
  readonly rootMargin = "0px";
  readonly thresholds: number[] = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
global.IntersectionObserver = IntersectionObserverMock;

// matchMedia mock (responsive components)
global.matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});

// scrollTo mock (jsdom doesn't implement)
window.scrollTo = () => {};

// Suppress zustand persist warnings in test environment
const originalError = console.error;
console.error = (...args: unknown[]) => {
  if (
    typeof args[0] === "string" &&
    args[0].includes("Unable to update item")
  ) {
    return;
  }
  originalError.call(console, ...args);
};
