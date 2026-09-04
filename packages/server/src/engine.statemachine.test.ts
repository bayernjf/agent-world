import { compile, Graph, type Graph as GraphType } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import type { AgentChunk, Worker } from "./worker.js";

const clock = () => 0;
const sleep = (_ms: number) => new Promise<void>((r) => setTimeout(r, 0));

/**
 * 方案 A 验证：订单状态机（待支付 → 已支付 → 已发货 → 已完成）用现有积木搭，
 * 不引入新节点类型。积木 = graph variables（跨 run 持久）+ branch（按 `${var.xxx}`
 * 路由）+ `set_variable`/`get_variable` 内置工具（推进状态）。
 *
 * 每次 run 由 source 投料一个订单事件，router 按 `var.orderState` 路由到当前
 * 状态对应的处理分支，该分支的 agent 调 `set_variable` 把状态推进一格，run 结束
 * 后变量写回 DB，下次 run 读到新状态——状态机由此闭环。
 */
function orderStateMachine(): GraphType {
  return Graph.parse({
    id: "g-order-fsm",
    name: "订单状态机",
    // 图级默认状态：首次 run 无持久化值时从这里起步。
    variables: { orderState: "待支付" },
    nodes: [
      { id: "src", kind: "source", name: "订单事件", x: 0, y: 0, source: {} },
      {
        id: "router",
        kind: "branch",
        name: "状态路由",
        x: 250,
        y: 0,
        branch: {
          rules: [
            { id: "r-pending", when: "${var.orderState} == '待支付'", target: "pay" },
            { id: "r-paid", when: "${var.orderState} == '已支付'", target: "ship" },
            { id: "r-shipped", when: "${var.orderState} == '已发货'", target: "sign" },
          ],
          defaultTarget: "done",
        },
      },
      {
        id: "pay",
        kind: "textGen",
        name: "支付处理",
        x: 500,
        y: -80,
        textGen: {
          model: "test",
          prompt: "确认支付，推进订单状态到已支付",
          temperature: 0,
          timeoutMs: 5000,
          retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
        },
      },
      {
        id: "ship",
        kind: "textGen",
        name: "发货处理",
        x: 500,
        y: 40,
        textGen: {
          model: "test",
          prompt: "确认发货，推进订单状态到已发货",
          temperature: 0,
          timeoutMs: 5000,
          retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
        },
      },
      {
        id: "sign",
        kind: "textGen",
        name: "签收处理",
        x: 500,
        y: 160,
        textGen: {
          model: "test",
          prompt: "确认签收，推进订单状态到已完成",
          temperature: 0,
          timeoutMs: 5000,
          retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
        },
      },
      { id: "done", kind: "sink", name: "已终止", x: 750, y: 0 },
      { id: "depot", kind: "sink", name: "成品仓", x: 750, y: 160 },
    ],
    edges: [
      { id: "e1", from: "src", to: "router", kind: "flow" },
      { id: "e2", from: "router", to: "pay", kind: "flow" },
      { id: "e3", from: "router", to: "ship", kind: "flow" },
      { id: "e4", from: "router", to: "sign", kind: "flow" },
      { id: "e5", from: "router", to: "done", kind: "flow" },
      { id: "e6", from: "pay", to: "depot", kind: "flow" },
      { id: "e7", from: "ship", to: "depot", kind: "flow" },
      { id: "e8", from: "sign", to: "depot", kind: "flow" },
    ],
  });
}

/**
 * 按节点 id 决定迁移动作的 fake worker：pay → 已支付、ship → 已发货、sign → 已完成。
 * router 每次只路由到一个状态分支，所以同一张图跑多次 run 时，只有被路由的那个
 * agent 会调 `set_variable`。真实场景里这里是"agent 读事件 + 当前状态 → 决定新状态"。
 */
function migrateWorker(
  migrations: Record<string, { key: string; value: unknown }>,
): Worker {
  return {
    async *runTextGen({ node, executeTool }): AsyncGenerator<
      AgentChunk,
      { output: string; usage: { tokensIn: number; tokensOut: number; costUsd: number } }
    > {
      const mig = migrations[node.id];
      if (mig && executeTool) {
        yield { type: "tool-call", id: "c1", name: "set_variable", arguments: { key: mig.key, value: mig.value } };
        const result = await executeTool("set_variable", { key: mig.key, value: mig.value });
        yield { type: "tool-result", id: "c1", name: "set_variable", result };
      }
      yield { type: "text-delta", text: `[${node.name}] 已处理` };
      return {
        output: `[${node.name}] 已处理`,
        usage: { tokensIn: 1, tokensOut: 1, costUsd: 0 },
      };
    },
    async judge() {
      return { passed: true, reason: "ok" };
    },
    async generateImage() {
      return [];
    },
  };
}

/** 跑一次 run，把事件原样收集回来，变量 Map 由 engine 按引用改写。 */
async function runOnce(
  runId: string,
  graph: GraphType,
  variables: Map<string, unknown>,
  worker: Worker,
): Promise<Array<Record<string, unknown>>> {
  const { plan } = compile(graph);
  if (!plan) throw new Error("no plan");
  const events: Array<Record<string, unknown>> = [];
  for await (const e of execute({
    runId,
    graph,
    plan,
    worker,
    budgetUsd: null,
    now: clock,
    sleep,
    initialVariables: variables,
  })) {
    events.push(e as Record<string, unknown>);
  }
  return events;
}

describe("状态机（variables + branch 组合，方案 A）", () => {
  const worker = migrateWorker({
    pay: { key: "orderState", value: "已支付" },
    ship: { key: "orderState", value: "已发货" },
    sign: { key: "orderState", value: "已完成" },
  });

  it("订单状态跨多次 run 逐步推进：待支付 → 已支付 → 已发货 → 已完成", async () => {
    const graph = orderStateMachine();

    // run 1：待支付 → 已支付
    const v1 = new Map<string, unknown>([["orderState", "待支付"]]);
    const e1 = await runOnce("r1", graph, v1, worker);
    expect(v1.get("orderState")).toBe("已支付");
    // router 命中「待支付」，只路由到 pay；ship/sign/done 未路由，被 skip。
    expect(e1.some((e) => e.type === "node.skipped" && e.nodeId === "ship")).toBe(true);
    expect(e1.some((e) => e.type === "node.skipped" && e.nodeId === "sign")).toBe(true);
    expect(e1.some((e) => e.type === "node.skipped" && e.nodeId === "done")).toBe(true);

    // run 2：已支付 → 已发货
    const v2 = new Map<string, unknown>([["orderState", "已支付"]]);
    await runOnce("r2", graph, v2, worker);
    expect(v2.get("orderState")).toBe("已发货");

    // run 3：已发货 → 已完成
    const v3 = new Map<string, unknown>([["orderState", "已发货"]]);
    await runOnce("r3", graph, v3, worker);
    expect(v3.get("orderState")).toBe("已完成");

    // run 4：已完成 → 走 default 分支（done），不再迁移
    const v4 = new Map<string, unknown>([["orderState", "已完成"]]);
    const e4 = await runOnce("r4", graph, v4, worker);
    expect(v4.get("orderState")).toBe("已完成");
    expect(e4.some((e) => e.type === "node.skipped" && e.nodeId === "pay")).toBe(true);
  });

  it("未提供持久化值时从图级默认状态起步（graph.variables 兜底）", async () => {
    const graph = orderStateMachine();
    // 模拟 run.ts 里 graph.variables 与持久化值合并：持久化为空 → 用默认值。
    const variables = new Map<string, unknown>(Object.entries(graph.variables ?? {}));
    expect(variables.get("orderState")).toBe("待支付");
    const events = await runOnce("r0", graph, variables, worker);
    expect(variables.get("orderState")).toBe("已支付");
    // 首个 run 命中「待支付」分支，路由到 pay。
    expect(events.some((e) => e.type === "packet.sent" && e.to === "pay")).toBe(true);
  });
});
