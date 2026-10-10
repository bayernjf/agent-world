import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DatabaseConnector,
  FileConnector,
  FormConnector,
  GraphNode,
  HttpConnector,
  ProductConnector,
} from "@agent-world/core";

/**
 * Guard against the defect class "core grew a field / the engine grew a path,
 * but no screen can reach it". Two real instances were caught by hand: the
 * manual product connector asked users to copy an id the library never renders,
 * and `videoGen.mode`/`imageSource` existed in the schema and the engine while
 * VideoGenFields only offered model/prompt/duration/aspect/n.
 *
 * Coverage means: the field name is addressed (`.field`) inside the kind's own
 * form file, or inside a module that file imports (one hop). Matching against
 * every form file would let a sibling's `.size` cover this kind's `.size`, so
 * the hop is deliberately narrow.
 *
 * The exemption tables are double-checked: an entry that stops being true also
 * fails, so a wired-up control cannot stay listed as debt.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS = join(HERE, "..");

/**
 * Keep only what could be a property access.
 *
 * Comments and env lookups do not count as a control, and neither do string
 * literals: i18n keys are shaped like the config paths they label, so
 * `t("nodes:inspector.imageGen.aspect")` would otherwise read as if the form
 * touched `aspect`. That leak was measured — a planted defect where the control
 * read `node.imageGen.ratio` stayed green until string literals were stripped.
 */
function readable(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\[\s\S])*`/g, "``")
    .replace(/process\.env/g, "@nodeenv")
    .replace(/import\.meta/g, "@metaprop");
}

function readForm(path: string): string {
  try {
    return readable(readFileSync(path, "utf8"));
  } catch {
    return "";
  }
}

/**
 * The form file itself — the surface this kind can render.
 *
 * Deliberately no import hop. Following `./shared` would let one mention of
 * `.aspect` inside a module that every form imports cover every kind, and
 * following `../lib/api` let an unrelated `.user` in the fetch client pass as a
 * control. Both were measured against this repo's real files. Cross-cutting
 * rendering is admitted by name instead (CROSS_CUTTING below).
 */
function formSurface(file: string): string {
  return readForm(file);
}

const registry = readForm(join(HERE, "registry.tsx"));
const FORM_BY_KIND = new Map<string, string>();
for (const m of registry.matchAll(/^\s*([a-zA-Z]+):\s*(\w+Fields),/gm)) {
  FORM_BY_KIND.set(m[1], join(HERE, `${m[2]}.tsx`));
}

/** GraphNode keys that are not per-kind configuration. */
const STRUCTURAL = new Set(["id", "kind", "name", "x", "y", "contract"]);

function configFields(kind: string): string[] {
  const slot = (GraphNode.shape as Record<string, never>)[kind];
  const inner = slot && "unwrap" in slot ? (slot as { unwrap(): never })["unwrap"]() : slot;
  const shape = (inner as { shape?: Record<string, unknown> })?.shape;
  return shape ? Object.keys(shape) : [];
}

const CONFIG_KINDS = Object.keys(GraphNode.shape).filter(
  (k) => !STRUCTURAL.has(k) && configFields(k).length > 0,
);

/**
 * Kinds with configuration the canvas cannot edit at all. Each entry is a
 * standing product gap, not a pass: removing it requires building the form.
 */
const KINDS_WITHOUT_FORM: Record<string, string> = {};

/** Fields rendered outside the per-kind form by a shared screen. */
const CROSS_CUTTING: Record<string, string> = {
  skills: "由 Inspector 的「技能」标签页统一渲染（components/Inspector.tsx 的 SkillPicker）",
};

/** Node-config fields with no control. Every entry is user-visible debt. */
const FIELD_DEBT: Record<string, Record<string, string>> = {
  textGen: { timeoutMs: "每节点超时只在 code/http 表单里有入口，textGen 表单漏" },
  videoGen: { size: "core 注释写明 set 时透传给 provider，表单只给 aspect" },
  code: {
    env: "允许进入沙箱子进程的变量名，无入口",
    fs: "sandbox/allowlist 文件策略，无入口",
    net: "故意不给：allowlist 未实现前引擎一律拒绝，UI 不该提供一个必然失败的开关",
  },
  database: {
    positionalParams: "SQL 绑定参数无入口，只能把值写死进语句",
    namedParams: "同上（:name / @name / $name）",
  },
  translate: { budgetUsd: "预算字段在别的表单有，translate 漏" },
  ocr: {
    workerPath: "故意不给：core 注释写明 Node 下必须留空，属部署级覆盖",
    corePath: "同上（tesseract-core WASM）",
  },
  search: { cx: "Google Custom Search engine id 只能靠 GOOGLE_CX 环境变量" },
  vcs: {
    inputs: "workflow/pipeline inputs 无入口",
    source: "无入口",
  },
  source: { inputSchema: "故意不给：core 注释写 Future，引擎侧尚无消费者" },
  compliance: { source: "上游多源时无法指定正文来自哪个节点（默认单一流线前驱）" },
  select: { passThroughAll: "mode=human 的人工挑选开关无入口" },
};

/** Source connectors are edited in one component, not per-kind forms. */
const CONNECTOR_EDITOR = join(COMPONENTS, "ConnectorEditor.tsx");
const CONNECTOR_SCHEMAS: Record<string, Record<string, unknown>> = {
  DatabaseConnector,
  FileConnector,
  FormConnector,
  HttpConnector,
  ProductConnector,
};

const CONNECTOR_DEBT: Record<string, Record<string, string>> = {
  DatabaseConnector: {
    params: "绑定参数无入口（positional/named；query 里只能把值写死）",
  },
  FileConnector: { encoding: "utf8/base64 无入口，默认 utf8" },
};

describe("node forms reach every config field", () => {
  it("gives every kind with configuration a form, except the registered gaps", () => {
    const missing = CONFIG_KINDS.filter(
      (kind) => !FORM_BY_KIND.has(kind) && !(kind in KINDS_WITHOUT_FORM),
    );
    expect(missing).toEqual([]);
  });

  it("keeps each registered no-form kind actually formless (otherwise delete the entry)", () => {
    const stale = Object.keys(KINDS_WITHOUT_FORM).filter((kind) => FORM_BY_KIND.has(kind));
    expect(stale).toEqual([]);
  });

  it("covers every field of every kind that has a form", () => {
    const gaps: string[] = [];
    for (const kind of CONFIG_KINDS) {
      const file = FORM_BY_KIND.get(kind);
      if (!file) continue;
      const surface = formSurface(file);
      for (const field of configFields(kind)) {
        if (CROSS_CUTTING[field] || FIELD_DEBT[kind]?.[field]) continue;
        if (!new RegExp(`\\.${field}\\b`).test(surface)) gaps.push(`${kind}.${field}`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it("keeps each registered field-debt entry genuinely unreachable", () => {
    const stale: string[] = [];
    for (const [kind, fields] of Object.entries(FIELD_DEBT)) {
      const file = FORM_BY_KIND.get(kind);
      if (!file) continue;
      const surface = formSurface(file);
      for (const field of Object.keys(fields)) {
        if (new RegExp(`\\.${field}\\b`).test(surface)) stale.push(`${kind}.${field}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("reaches every source connector field, except the registered gaps", () => {
    const surface = formSurface(CONNECTOR_EDITOR);
    const gaps: string[] = [];
    for (const [name, schema] of Object.entries(CONNECTOR_SCHEMAS)) {
      for (const field of Object.keys(schema.shape as Record<string, unknown>)) {
        if (CONNECTOR_DEBT[name]?.[field]) continue;
        if (!new RegExp(`\\.${field}\\b`).test(surface)) gaps.push(`${name}.${field}`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it("keeps each registered connector-debt entry genuinely unreachable", () => {
    const surface = formSurface(CONNECTOR_EDITOR);
    const stale: string[] = [];
    for (const [name, fields] of Object.entries(CONNECTOR_DEBT)) {
      for (const field of Object.keys(fields)) {
        if (new RegExp(`\\.${field}\\b`).test(surface)) stale.push(`${name}.${field}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("has the media controls this batch added, and names them as covered", () => {
    // Not a restatement of the loop above: these three fields are the reason
    // the guard exists, so pin them by name against the exact forms.
    const video = formSurface(FORM_BY_KIND.get("videoGen")!);
    const image = formSurface(FORM_BY_KIND.get("imageGen")!);
    for (const field of ["mode", "imageSource", "aspect", "duration", "n"]) {
      expect(video, `videoGen.${field}`).toMatch(new RegExp(`\\.${field}\\b`));
    }
    for (const field of ["aspect", "size", "n", "prompt"]) {
      expect(image, `imageGen.${field}`).toMatch(new RegExp(`\\.${field}\\b`));
    }
  });
});
