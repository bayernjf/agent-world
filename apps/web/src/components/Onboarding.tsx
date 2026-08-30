import { useMemo, useState } from "react";
import { api } from "../lib/api";
import TemplatePicker, { TEMPLATE_LIST } from "./TemplatePicker";
import TemplateFieldDialog from "./TemplateFieldDialog";

interface Props {
  onCreate: (templateId?: string, fieldValues?: Record<string, string>) => void;
}

export default function Onboarding({ onCreate }: Props) {
  const templates = useMemo(() => TEMPLATE_LIST, []);

  const [apiStatus, setApiStatus] = useState<"unknown" | "ok" | "fail">("unknown");
  const [pending, setPending] = useState<(typeof TEMPLATE_LIST)[number] | null>(null);
  // Probe the engine once so the user knows whether saved-state features will work.
  useMemo(() => {
    api
      .listGraphs()
      .then(() => setApiStatus("ok"))
      .catch(() => setApiStatus("fail"));
  }, []);

  return (
    <div className="onboarding">
      <div className="onboarding__content">
        <div className="onboarding__hero">
          <h1 className="onboarding__title">欢迎来到 Agent World</h1>
          <p className="onboarding__subtitle">
            用可视化的方式编排多 Agent 工作流。每个 Agent 是产线上的一个节点，
            产出物通过管道在节点间流动，质检站可以把不合格的工作打回重做。
          </p>
        </div>

        <div className="onboarding__section">
          <h2 className="onboarding__section-title">选择一个模板开始</h2>
          <p className="onboarding__section-hint">
            模板预置了节点和连线，创建后可自由编辑。共 {templates.length} 个模板。
          </p>

          <TemplatePicker
            templates={templates}
            onPick={(id) => {
              const tpl = id ? templates.find((t) => t.id === id) : undefined;
              // Templates with declared fields get a parameter form first.
              if (tpl && tpl.fields.length > 0) setPending(tpl);
              else onCreate(id);
            }}
            cardClass="onboarding"
          />
        </div>

        <div className="onboarding__divider">
          <span>或</span>
        </div>

        <div className="onboarding__actions">
          <button className="btn btn--primary btn--lg" onClick={() => onCreate()}>
            从空白产线开始
          </button>
        </div>

        <div className="onboarding__tips">
          <p>
            <strong>提示：</strong>
            运行产线前需要在设置（⚙️）中配置模型 Provider。未配置时会使用内置的假 Worker，
            适合熟悉界面和测试流程。
          </p>
          {apiStatus === "fail" && (
            <p className="onboarding__tip-warn">
              ⚠ 后端引擎未响应（http://localhost:8791）。点击创建时如失败，请先{" "}
              <code>pnpm --filter @agent-world/server dev</code> 启动后端。
            </p>
          )}
        </div>
      </div>

      {pending && (
        <TemplateFieldDialog
          templateName={pending.name}
          fields={pending.fields}
          onCancel={() => setPending(null)}
          onSubmit={(values) => {
            setPending(null);
            onCreate(pending.id, values);
          }}
        />
      )}
    </div>
  );
}
