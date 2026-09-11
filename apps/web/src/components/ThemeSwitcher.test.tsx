import { act, render, screen, fireEvent } from "@testing-library/react";
import i18n from "../i18n";
import ThemeSwitcher from "./ThemeSwitcher";

const STORAGE_KEY = "agent-world-theme";

describe("ThemeSwitcher", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    await act(async () => {
      await i18n.changeLanguage("zh");
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("names light as the theme it would switch to while in dark", () => {
    render(<ThemeSwitcher />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toBe("亮色");
    expect(btn).toHaveAttribute("title", "切换到亮色主题");
  });

  it("toggles data-theme and persists on click, and toggles back", () => {
    render(<ThemeSwitcher />);
    const btn = screen.getByRole("button");

    act(() => {
      fireEvent.click(btn);
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("light");
    expect(btn.textContent).toBe("暗色");
    expect(btn).toHaveAttribute("title", "切换到暗色主题");

    act(() => {
      fireEvent.click(btn);
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(btn.textContent).toBe("亮色");
  });

  it("honors a persisted light theme on mount", () => {
    window.localStorage.setItem(STORAGE_KEY, "light");
    render(<ThemeSwitcher />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toBe("暗色");
  });

  it("uses English labels when the UI language is English", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    render(<ThemeSwitcher />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toBe("Light");
    expect(btn).toHaveAttribute("title", "Switch to light theme");
  });
});
