import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * Minimal end-to-end smoke coverage (engineering-blueprint §"质量体系"):
 * the app boots, a guest is gated to the login page, and the one-click demo
 * provisions a real account and lands inside the actual product. It exercises
 * the full stack (vite web -> Hono server -> SQLite) but never runs a pipeline,
 * so no AI provider key or paid plan is needed.
 */

// Resource/DevTools noise that is not an application defect in dev mode.
const IGNORED_CONSOLE = /Failed to load resource|favicon|net::ERR|react-devtools|Download the React DevTools/i;

/** Capture uncaught page exceptions and unexpected console errors. */
function collectErrors(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  return { consoleErrors, pageErrors };
}

test.describe("guest and demo smoke", () => {
  test("a guest opening the app is redirected to the login page", async ({ page }) => {
    await page.goto("/");

    // ProtectedRoute probes /api/auth/me and, when unauthenticated, redirects.
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByRole("button", { name: /演示|demo/i }),
    ).toBeVisible();
  });

  test("one-click demo enters the real product under a demo session", async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);

    await page.goto("/login");
    await page.getByRole("button", { name: /演示|demo/i }).first().click();

    // POST /api/auth/demo provisions the account, then the app navigates "/".
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 15_000,
    });
    await expect(page).not.toHaveURL(/\/login/);

    // DemoBanner is rendered only for an authenticated demo user inside the
    // real product — it is the strongest signal that the demo session works.
    await expect(
      page.getByRole("status").filter({ hasText: /演示模式|demo mode/i }),
    ).toBeVisible();

    // No uncaught client exception and no unexpected console error on entry.
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
    const realConsoleErrors = consoleErrors.filter((m) => !IGNORED_CONSOLE.test(m));
    expect(realConsoleErrors, realConsoleErrors.join("\n")).toEqual([]);
  });
});
