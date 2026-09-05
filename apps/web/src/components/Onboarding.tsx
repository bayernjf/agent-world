import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "../lib/api";
import TemplatePicker, { TEMPLATE_LIST } from "./TemplatePicker";
import TemplateFieldDialog from "./TemplateFieldDialog";
import { useTemplateAlerts } from "./AnnouncementAlerts";

interface Props {
  onCreate: (templateId?: string, fieldValues?: Record<string, string>) => void;
}

export default function Onboarding({ onCreate }: Props) {
  const { t } = useTranslation();
  const templates = useMemo(() => TEMPLATE_LIST, []);
  // P3 targeting: deprecation-style notices pinned to their template's card.
  const alerts = useTemplateAlerts();

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
          <h1 className="onboarding__title">{t("modals:onboarding.title")}</h1>
          <p className="onboarding__subtitle">{t("modals:onboarding.subtitle")}</p>
        </div>

        <div className="onboarding__section">
          <h2 className="onboarding__section-title">
            {t("modals:onboarding.sectionTitle")}
          </h2>
          <p className="onboarding__section-hint">
            {t("modals:onboarding.sectionHint", { count: templates.length })}
          </p>

          <TemplatePicker
            templates={templates}
            blankFirst
            alerts={alerts}
            onPick={(id) => {
              const tpl = id ? templates.find((x) => x.id === id) : undefined;
              // Templates with declared fields get a parameter form first.
              if (tpl && tpl.fields.length > 0) setPending(tpl);
              else onCreate(id);
            }}
            cardClass="onboarding"
          />
        </div>

        <div className="onboarding__tips">
          <p>
            <Trans
              i18nKey="modals:onboarding.tips"
              components={{ strong: <strong /> }}
            />
          </p>
          {apiStatus === "fail" && (
            <p className="onboarding__tip-warn">
              <Trans
                i18nKey="modals:onboarding.engineDown"
                components={{ code: <code /> }}
              />
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
