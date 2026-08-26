/**
 * Minimal 5-field cron evaluator (UTC). Supports "*", "?", lists like "a,b",
 * ranges like "a-b", and steps like "0/15" or "a-b/n". Returns the next fire
 * time strictly after `from`, or `null` if the expression is invalid or no
 * match occurs within a ~10-year horizon.
 *
 * Evaluated in UTC so behavior is deterministic regardless of server timezone.
 */
export function nextRunAfter(expr: string, from: Date): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const minutes = parseField(parts[0] ?? "", 0, 59);
  const hours = parseField(parts[1] ?? "", 0, 23);
  const doms = parseField(parts[2] ?? "", 1, 31);
  const months = parseField(parts[3] ?? "", 1, 12);
  const dows = parseField(parts[4] ?? "", 0, 7); // 7 is normalized to 0 (Sunday)
  if (!minutes || !hours || !doms || !months || !dows) return null;

  const domStar = isStar(parts[2] ?? "");
  const dowStar = isStar(parts[4] ?? "");

  const d = new Date(from.getTime());
  d.setUTCMilliseconds(0);
  d.setUTCSeconds(0);
  d.setUTCMinutes(d.getUTCMinutes() + 1); // strictly after `from`

  const limit = from.getTime() + 10 * 366 * 24 * 60 * 60 * 1000;

  while (d.getTime() < limit) {
    if (!months.has(d.getUTCMonth() + 1)) {
      d.setUTCDate(1);
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCMonth(d.getUTCMonth() + 1);
      continue;
    }

    const date = d.getUTCDate();
    const dow = d.getUTCDay();
    let dayOk: boolean;
    if (domStar && dowStar) dayOk = true;
    else if (domStar) dayOk = dows.has(dow);
    else if (dowStar) dayOk = doms.has(date);
    else dayOk = doms.has(date) || dows.has(dow);
    if (!dayOk) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }

    if (!hours.has(d.getUTCHours())) {
      d.setUTCMinutes(0, 0, 0);
      d.setUTCHours(d.getUTCHours() + 1);
      continue;
    }
    if (!minutes.has(d.getUTCMinutes())) {
      d.setUTCSeconds(0, 0);
      d.setUTCMinutes(d.getUTCMinutes() + 1);
      continue;
    }

    return new Date(d);
  }
  return null;
}

/** True for the "any" tokens in a field. */
function isStar(field: string): boolean {
  return field === "*" || field === "?";
}

/** Parses one cron field into the set of allowed values, or null if invalid. */
function parseField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  if (isStar(field)) {
    for (let i = min; i <= max; i++) out.add(i);
    return out;
  }
  for (const part of field.split(",")) {
    if (part === "") return null;
    let step = 1;
    let range = part;
    if (part.includes("/")) {
      const segs = part.split("/");
      const parsedStep = toInt(segs[1]);
      if (parsedStep == null || parsedStep <= 0) return null;
      step = parsedStep;
      const rawRange = segs[0] ?? "";
      range = rawRange === "" || rawRange === "*" || rawRange === "?" ? `${min}-${max}` : rawRange;
    }
    let lo: number;
    let hi: number;
    if (range.includes("-")) {
      const segs = range.split("-");
      const loVal = toInt(segs[0]);
      const hiVal = toInt(segs[1]);
      if (loVal == null || hiVal == null || loVal > hiVal) return null;
      lo = loVal;
      hi = hiVal;
    } else {
      const v = toInt(range);
      if (v == null) return null;
      lo = hi = v;
    }
    for (let i = lo; i <= hi; i += step) {
      const v = i === 7 ? 0 : i;
      if (v < min || v > max) return null;
      out.add(v);
    }
  }
  return out;
}

function toInt(s: string | undefined): number | null {
  if (s == null || !/^\d+$/.test(s)) return null;
  return Number(s);
}
