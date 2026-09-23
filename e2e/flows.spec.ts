import { expect, test, type Page } from "@playwright/test";

/**
 * Core authenticated flows that never run a pipeline (so no AI provider key
 * or paid plan is needed):
 *   1. self-service registration lands on the template onboarding screen;
 *   2. creating a blank line enters the real canvas, and the settings dialog
 *      tabs switch;
 *   3. logging out and back in persists the created line.
 *
 * The Playwright webServer starts the server with ALLOW_REGISTRATION=1 and a
 * throwaway DB (see playwright.config.ts), so every test can provision a
 * unique account without colliding with the first-account bootstrap or the
 * per-IP registration rate limit.
 */

const PASSWORD = "test1234";
// first-run tour seen key (store/guided-tour.ts): suppress the spotlight tour
// so it never overlaps the elements these flows assert on.
const TOUR_SEEN_KEY = "aw.tour.seen:first-run:1.0.0";

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Register a fresh account via the UI and wait until inside the product. */
async function register(page: Page, email: string): Promise<void> {
  // Runs before any page script on every same-origin document, so the tour is
  // already marked seen before post-registration auto-scheduling runs.
  await page.addInitScript((key) => {
    try {
      localStorage.setItem(key, new Date().toISOString());
    } catch {
      /* non-fatal */
    }
  }, TOUR_SEEN_KEY);

  await page.goto("/register");
  await page.locator('input[type="email"]').fill(email);
  const passwords = page.locator('input[type="password"]');
  await passwords.first().fill(PASSWORD);
  await passwords.nth(1).fill(PASSWORD);
  await page.getByRole("button", { name: /注册|Register/ }).click();

  await page.waitForURL(
    (url) => !url.pathname.startsWith("/register") && !url.pathname.startsWith("/login"),
    { timeout: 15_000 },
  );
}

/** From onboarding, pick the blank-line card and wait for the canvas. */
async function createBlankLine(page: Page): Promise<void> {
  await page.locator(".template-card--blank").click();
  await expect(page.locator("main.stage")).toBeVisible();
  await expect(page.locator(".onboarding")).toHaveCount(0);
}

test.describe("authenticated core flows (no AI)", () => {
  test("a new user registers and lands on the template onboarding screen", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await register(page, uniqueEmail());

    await expect(
      page.getByRole("heading", { name: /欢迎来到 Agent World|Welcome to Agent World/ }),
    ).toBeVisible();
    // The blank-line card is pinned first in the onboarding picker.
    await expect(page.locator(".template-card--blank")).toBeVisible();

    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });

  test("creates a blank line, enters the canvas, and switches settings tabs", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await register(page, uniqueEmail());
    await createBlankLine(page);

    // Open settings from the control panel footer.
    await page
      .locator(".control__footer")
      .getByRole("button", { name: /设置|Settings/ })
      .click();

    const tablist = page.getByRole("tablist");
    await expect(tablist).toBeVisible();
    // All four tabs are present.
    await expect(page.getByRole("tab")).toHaveCount(4);

    // Switching tabs flips aria-selected; content panels mount without keys.
    for (const name of [/集成|Integrations/, /技能|Skills/, /套餐与用量|Plan & Usage/]) {
      const tab = page.getByRole("tab", { name });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }

    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });

  test("logs out and logs back in, keeping the created line", async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);
    await createBlankLine(page);

    // Account menu -> log out.
    await page.locator(".user-menu__chip").click();
    await page.getByRole("button", { name: /退出登录|Log out/ }).click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    // Log back in with the same credentials.
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /登录|Log in/ }).click();

    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 15_000,
    });

    // The account owns one line, so the app reopens the canvas directly
    // (onboarding only renders for accounts with zero lines).
    await expect(page.locator("main.stage")).toBeVisible();
    await expect(page.locator(".onboarding")).toHaveCount(0);
  });
});
