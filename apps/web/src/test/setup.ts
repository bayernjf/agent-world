import "@testing-library/jest-dom";

// ResizeObserver mock (components use it for size tracking)
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverMock;

// IntersectionObserver mock (lazy loading, infinite scroll)
class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
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
