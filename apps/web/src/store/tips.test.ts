import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock localStorage BEFORE dynamically importing the store.
// tips.ts calls initial() at module load time, which reads localStorage.
const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    store.delete(key);
  }),
  clear: vi.fn(() => {
    store.clear();
  }),
};

vi.stubGlobal("localStorage", mockLocalStorage);

// Dynamic import after stubbing global localStorage.
const { useTips } = await import("./tips");

describe("useTips", () => {
  beforeEach(() => {
    store.clear();
    mockLocalStorage.getItem.mockClear();
    mockLocalStorage.setItem.mockClear();
    // Reset to default enabled state.
    useTips.setState({ enabled: true });
  });

  it("defaults to enabled when localStorage has no 'off' value", () => {
    expect(useTips.getState().enabled).toBe(true);
  });

  it("toggle switches enabled from true to false and persists 'off'", () => {
    useTips.setState({ enabled: true });
    useTips.getState().toggle();
    expect(useTips.getState().enabled).toBe(false);
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith("aw.tips", "off");
  });

  it("toggle switches enabled from false to true and persists 'on'", () => {
    useTips.setState({ enabled: false });
    useTips.getState().toggle();
    expect(useTips.getState().enabled).toBe(true);
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith("aw.tips", "on");
  });

  it("setEnabled(true) sets enabled and persists 'on'", () => {
    useTips.setState({ enabled: false });
    useTips.getState().setEnabled(true);
    expect(useTips.getState().enabled).toBe(true);
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith("aw.tips", "on");
  });

  it("setEnabled(false) sets enabled and persists 'off'", () => {
    useTips.setState({ enabled: true });
    useTips.getState().setEnabled(false);
    expect(useTips.getState().enabled).toBe(false);
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith("aw.tips", "off");
  });

  it("setEnabled with same value still persists", () => {
    useTips.setState({ enabled: true });
    useTips.getState().setEnabled(true);
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith("aw.tips", "on");
  });
});
