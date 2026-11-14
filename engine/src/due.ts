/**
 * When an ask is due (SCR-97), read from the words of the message that made the task, relative to
 * the message's own date (or when it was seen, when the app shows none). Deterministic: a phrase
 * either names one day or the task gets no date. Two different days, or a numeric date that could
 * be day/month or month/day, give none.
 *
 * Due dates order the list, wake a snoozed task early and give one reminder on the day. They never
 * tick anything. Stored as a local calendar day, "YYYY-MM-DD".
 */

const WEEKDAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** A local calendar day as "YYYY-MM-DD". */
export function dayOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, n: number): Date {
  const out = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

/** The next `weekday` on or after `from` (today counts: "by Friday" said on a Friday is today). */
function onOrAfter(from: Date, weekday: number): Date {
  return addDays(from, (weekday - from.getDay() + 7) % 7);
}

function valid(y: number, m: number, d: number): Date | null {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

/** Every day a message names as its deadline. */
function daysNamed(text: string, ref: Date): Date[] {
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const found: Date[] = [];
  const en = (re: RegExp) => re.test(t);

  if (en(/\b(today|tonight|eod|end of (the )?day|cob|close of business)\b/) || /(היום|הערב|סוף היום)/.test(t)) found.push(addDays(ref, 0));
  if (en(/\btomorrow\b/) || /מחר/.test(t)) found.push(addDays(ref, 1));
  if (en(/\b(eow|end of (the )?week)\b/) || /סוף השבוע/.test(t)) found.push(onOrAfter(ref, 5));
  if (en(/\bnext week\b/) || /(בשבוע הבא|שבוע הבא)/.test(t)) found.push(addDays(onOrAfter(addDays(ref, 1), 1), 0));

  // "by Friday", "before Monday", "until Thu", "due Tuesday", "on Wednesday", "this Friday". Not
  // "next Friday": this coming one or the one after, people differ, so it is left empty.
  WEEKDAYS_EN.forEach((name, i) => {
    const short = name.slice(0, 3);
    if (new RegExp(`\\b(by|before|until|till|due|on|this|no later than)( the)? (${name}|${short})\\b`).test(t)
      && !new RegExp(`\\bnext (${name}|${short})\\b`).test(t)) found.push(onOrAfter(ref, i));
  });
  // "עד יום חמישי", "ביום חמישי", "עד חמישי".
  WEEKDAYS_HE.forEach((name, i) => {
    if (new RegExp(`(עד|ב|לפני)\\s*(יום\\s+)?${name}(?![\\u0590-\\u05FF])`).test(t)) found.push(onOrAfter(ref, i));
  });

  // A calendar date counts only after a word that makes it a deadline ("by", "due", "on", "עד").
  const CUE = '(?:\\b(?:by|before|until|till|due(?: on| by)?|on|no later than|deadline:?)(?: the)? |(?:עד|לפני|ב-?)\\s*)';
  // ISO: 2026-11-20.
  for (const m of t.matchAll(new RegExp(`${CUE}(20\\d\\d)-(\\d\\d)-(\\d\\d)\\b`, 'g'))) {
    const d = valid(Number(m[1]), Number(m[2]), Number(m[3]));
    if (d) found.push(d);
  }
  // "20 November", "November 20", "Nov 20th", with an optional year.
  MONTHS_EN.forEach((name, i) => {
    const mon = `(?:${name}|${name.slice(0, 3)})`;
    for (const m of t.matchAll(new RegExp(`${CUE}(?:(\\d{1,2})(?:st|nd|rd|th)? ${mon}\\b(?: (20\\d\\d))?|${mon} (\\d{1,2})(?:st|nd|rd|th)?\\b(?:,? (20\\d\\d))?)`, 'g'))) {
      const day = Number(m[1] ?? m[3]);
      const year = Number(m[2] ?? m[4] ?? ref.getFullYear());
      const d = valid(year, i + 1, day);
      if (d) found.push(d);
    }
  });
  // Numeric "20/11", "20.11.2026", "11/20": only when day and month cannot be swapped.
  for (const m of t.matchAll(new RegExp(`${CUE}(\\d{1,2})[/.](\\d{1,2})(?:[/.](20\\d\\d|\\d\\d))?(?![\\d/.])`, 'g'))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : ref.getFullYear();
    if (a <= 12 && b <= 12 && a !== b) continue; // 3/4: March 4th or 3 April? Left empty.
    const d = a > 12 ? valid(year, b, a) : valid(year, a, b);
    if (d) found.push(d);
  }
  return found;
}

/**
 * The day a message asks for, or null: none named, or more than one different day. `ref` is when the
 * message was sent (or seen).
 */
export function dueFrom(text: string, ref: Date): string | null {
  const days = [...new Set(daysNamed(text, ref).map(dayOf))];
  return days.length === 1 ? days[0]! : null;
}
