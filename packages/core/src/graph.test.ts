import { describe, expect, it } from "vitest";
import {
  AudioGenConfig,
  GenericConfig,
  ImageGenConfig,
  TextGenConfig,
  VideoGenConfig,
} from "./graph.js";

// 规则 B 的地基（docs/design-model-catalog.md）：五个带模型的节点配置都把
// `model: ""` 当作合法值，并且缺省就是它。以前这些字段写着内置模型名当 default
// （或 min(1) 直接拒绝空值），于是"换内置默认模型"对新建产线无效——每个节点从
// 出生起就钉死在某个供应商的某个型号上。派发时 resolveModelSlots 把 "" 换成
// 用户当前的默认，所以这里要钉住的是"空是合法的、且是默认值"。
describe("model slots", () => {
  const schemas = [
    ["TextGenConfig", TextGenConfig],
    ["ImageGenConfig", ImageGenConfig],
    ["VideoGenConfig", VideoGenConfig],
    ["AudioGenConfig", AudioGenConfig],
    ["GenericConfig", GenericConfig],
  ] as const;

  it("omitting the model yields the follow-default slot", () => {
    for (const [name, schema] of schemas) {
      expect(schema.parse({}).model, `${name} 的默认值应改为跟随默认`).toBe("");
    }
  });

  it("accepts an explicit empty string instead of rejecting it", () => {
    for (const [name, schema] of schemas) {
      expect(schema.parse({ model: "" }).model, `${name} 拒绝空模型名`).toBe("");
    }
  });

  it("keeps a pinned name untouched (存量产线语义不变)", () => {
    for (const [name, schema] of schemas) {
      expect(schema.parse({ model: "my-model" }).model, name).toBe("my-model");
    }
  });
});
