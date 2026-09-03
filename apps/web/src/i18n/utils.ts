import i18n from "./index";

/** Resolve the BCP-47 locale tag for the current (or given) language. */
function locale(lang?: string): string {
  const l = (lang ?? i18n.language ?? "zh").toLowerCase();
  return l.startsWith("zh") ? "zh-CN" : "en-US";
}

/** Date only, e.g. "2026年9月3日" / "Sep 3, 2026". */
export function formatDate(
  date: Date | number | string,
  lang?: string,
): string {
  return new Intl.DateTimeFormat(locale(lang), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

/** Date + time, e.g. "2026年9月3日 14:30" / "Sep 3, 2026, 2:30 PM". */
export function formatDateTime(
  date: Date | number | string,
  lang?: string,
): string {
  return new Intl.DateTimeFormat(locale(lang), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

/** Compact month/day + time (24h), e.g. "9月3日 14:30" / "9/3, 14:30". */
export function formatShortDateTime(
  date: Date | number | string | null | undefined,
  lang?: string,
): string {
  if (date == null || date === "") return "";
  return new Intl.DateTimeFormat(locale(lang), {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(date));
}

/** Grouped number, e.g. "1,234,567". */
export function formatNumber(num: number, lang?: string): string {
  return new Intl.NumberFormat(locale(lang)).format(num);
}

/** Currency, e.g. "¥99.90" / "$99.90". */
export function formatCurrency(
  amount: number,
  lang?: string,
  currency = "CNY",
): string {
  return new Intl.NumberFormat(locale(lang), {
    style: "currency",
    currency,
  }).format(amount);
}

/** Relative time, e.g. "1小时前" / "1 hour ago". */
export function formatRelativeTime(
  date: Date | number | string,
  lang?: string,
): string {
  const diff = Date.now() - new Date(date).getTime();
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto" });

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return rtf.format(-days, "day");
  if (hours > 0) return rtf.format(-hours, "hour");
  if (minutes > 0) return rtf.format(-minutes, "minute");
  return rtf.format(-seconds, "second");
}
