import { useTranslation } from "react-i18next";
import { TOURS } from "../tours";
import { hasSeen, useGuidedTour } from "../store/guided-tour";

/**
 * Minimal "Tours & what's new" list (design decision D5): enumerates every
 * registered tour, marks the ones already seen, and replays on click. Adding a
 * tour to the registry makes it appear here with no extra wiring (§12.9).
 */
export default function GuidedToursMenu({ onReplay }: { onReplay?: () => void }) {
  const { t } = useTranslation();
  const start = useGuidedTour((s) => s.start);

  if (TOURS.length === 0) return null;

  return (
    <div className="user-menu__tours">
      <div className="user-menu__tours-title">{t("tour:menu.title")}</div>
      {TOURS.map((tour) => {
        const seen = hasSeen(tour.id, tour.version);
        return (
          <button
            key={tour.id}
            type="button"
            className="user-menu__tour-item"
            onClick={() => {
              start(tour.id);
              onReplay?.();
            }}
          >
            <span>{t(tour.titleKey)}</span>
            {seen && (
              <span className="user-menu__tour-seen" aria-label={t("tour:menu.seen")}>
                ✓ {t("tour:menu.seen")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
