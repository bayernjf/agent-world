import { act, render, screen, fireEvent } from "@testing-library/react";
import i18n from "../i18n";
import LanguageSwitcher from "./LanguageSwitcher";

describe("LanguageSwitcher", () => {
  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("zh");
    });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("zh");
    });
  });

  it("shows English as the language it would switch to while in zh", () => {
    render(<LanguageSwitcher />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toBe("English");
    expect(btn).toHaveAttribute("title", "Switch to English");
  });

  it("switches to English on click and back to Chinese on the next click", async () => {
    render(<LanguageSwitcher />);
    const btn = screen.getByRole("button");
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.textContent).toBe("中文");
    expect(btn).toHaveAttribute("title", "切换到中文");
    expect(i18n.language.startsWith("en")).toBe(true);

    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.textContent).toBe("English");
    expect(i18n.language.startsWith("zh")).toBe(true);
  });

  it("shows Chinese as the switch target when already in English", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    render(<LanguageSwitcher />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toBe("中文");
    expect(btn).toHaveAttribute("title", "切换到中文");
  });
});
