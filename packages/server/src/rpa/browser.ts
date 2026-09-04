import { existsSync } from "node:fs";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { RPA_HEADLESS_DEFAULT } from "./adapter.js";

/**
 * Playwright 浏览器生命周期 + storageState 登录态管理。
 *
 * 风控对策（见 design-ecommerce-roadmap §F7-C，无 100% 保证）：
 *   - headful（非 headless）默认，降低自动化特征；
 *   - `--disable-blink-features=AutomationControlled` 关闭 navigator.webdriver 标记；
 *   - 登录态走 `storageState`：扫码一次持久化，之后复用，过期再扫。
 */

export interface RpaBrowser {
  browser: Browser;
  context: BrowserContext;
  close: () => Promise<void>;
}

/** 启动 Chromium 并新建/恢复上下文。 */
export async function launchRpaBrowser(opts: {
  headless?: boolean;
  /** storageState 文件路径；存在则复用会话，否则新建。 */
  stateFile?: string;
} = {}): Promise<RpaBrowser> {
  const headless = opts.headless ?? RPA_HEADLESS_DEFAULT;
  const browser = await chromium.launch({
    headless,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const storageState =
    opts.stateFile && existsSync(opts.stateFile) ? opts.stateFile : undefined;
  const context = await browser.newContext(storageState ? { storageState } : {});

  return {
    browser,
    context,
    close: async () => {
      await browser.close();
    },
  };
}

/** 持久化当前会话（扫码登录成功后调用，之后复用免扫码）。 */
export async function saveSession(context: BrowserContext, stateFile: string): Promise<void> {
  await context.storageState({ path: stateFile });
}
