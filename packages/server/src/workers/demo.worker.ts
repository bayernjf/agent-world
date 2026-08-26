import { routingWorker } from "../providers/index.js";
import type { WorkerPlugin } from "../worker-plugins.js";

/**
 * 示例插件：直接复用内置 routing worker。
 *
 * 插件约定：一个 `*.worker.ts` 文件，导出一个 `plugin: WorkerPlugin`：
 *   - id        唯一标识，运行时通过 workerId 选用
 *   - name      展示名
 *   - models    该 worker 支持的模型（用于 UI 提示）
 *   - createWorker()  返回一个 Worker 实例
 *
 * 新增一个自定义 worker（例如对接别的模型供应商）只需把类似文件放进
 * workers/ 目录，无需改动引擎或核心代码。重启后 `GET /api/workers` 即可看到。
 */
export const plugin: WorkerPlugin = {
  id: "demo-agnes",
  name: "Demo Worker",
  description:
    "示例插件：复用内置 routing worker。复制本文件并改写 createWorker 即可接入自定义模型。",
  models: ["agnes-2.0-flash", "agnes-2.0-pro"],
  createWorker: () => routingWorker(),
};
