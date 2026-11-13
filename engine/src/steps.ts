/**
 * Steps in any format (SCR-84). Assistants write steps for you in more shapes than a numbered list:
 * "Step 1 — Create the project" headings, "### 2. Add the key", bullets under "Next steps:", boxes
 * to tick ("☐ …"), a table of what to set where, and a command in a code block ("bash", "Copy code",
 * then the command). `normalizeSteps` rewrites those shapes as the numbered lines, boxes and
 * backticked commands `extractChecklists` and `extractCommands` already read, so every rule about who
 * a list is for, what counts as a step and what a step's marker is stays in one place.
 *
 * `stepTarget` is the other half: a step that names what it acts on (an env name, a URL or callback
 * path, a dashboard path, a known service, a key or a command) is a step even without a known verb.
 */

/** "Step 1 — Create the project", "Step 2: Add the key", "## Step 3. Deploy". */
const STEP_HEADING = /^(\s*)(?:#{1,6}\s*)?(?:\*\*)?step\s+(\d{1,2})\s*(?:[—–:.)-]|\*\*)\s*(?:\*\*\s*)?(\S.*)$/i;
/** "### 2. Add the key", "## 3) Deploy". */
const NUMBERED_HEADING = /^(\s*)#{1,6}\s*(\d{1,2})\s?[.)]\s+(\S.*)$/;
/** A heading or lead-in that hands the reader the steps that follow. */
const HUMAN_SECTION =
  /^(?:#{1,6}\s*)?(?:next steps(?: for you)?|what you(?:'ll| will)? need to do|you(?:'ll| will)? need to|on your (?:side|end)|before (?:you deploy|you launch|this works(?: in prod(?:uction)?)?|going live)|to finish(?: (?:the |your )?setup)?|manual steps|steps|your (?:steps|part|turn)|to do|todo|action items|for you to do)\b[^.!?]{0,60}:?\s*$/i;
const BULLET = /^(\s*)[-•*·▪◦]\s+(\S.*)$/;
/** A box to tick as an app shows one: empty, or ticked (then it is skipped, as "[x]" is). */
const GLYPH_BOX = /^(\s*)([☐☑☒✅])\s*(\S.*)$/;
/** A code block's language label and copy button, as a chat app's accessibility text shows them. */
const CODE_LANGUAGE = /^\s*(?:bash|sh|zsh|shell|console|terminal|powershell|cmd)\s*$/i;
const COPY_BUTTON = /^\s*(?:copy(?: code)?|copied!?)\s*$/i;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_RULE = /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/;
const LIST_LINE = /^\s*(?:[-•*·●⏺]\s*)?\d{1,2}\s?[.)]\s+\S/;

export interface NormalizeOptions {
  /** A chat window: boxes drawn as glyphs ("☐") are the app's checklist. In a terminal they are an agent's own todo list. */
  chat?: boolean;
}

export function normalizeSteps(text: string, opts: NormalizeOptions = {}): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let underHeading: string | null = null; // the indent to give a step heading's paragraph
  let section = false; // inside bullets under a human-steps heading
  let sectionIndent = -1;
  let bulletNo = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^⟦.*⟧$/.test(line)) {
      underHeading = null;
      section = false;
      out.push(line);
      continue;
    }

    // A command in a code block: "bash", "Copy code", then the command.
    if (CODE_LANGUAGE.test(line) && COPY_BUTTON.test(lines[i + 1] ?? '')) {
      const code = (lines[i + 2] ?? '').trim();
      if (code && !code.includes('`')) {
        out.push(`${underHeading ?? ''}\`${code}\``);
        i += 2;
        continue;
      }
    }

    // A table under a lead-in: each data row a step, its cells joined.
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] ?? '')) {
      let n = 0;
      let j = i + 2;
      for (; j < lines.length && TABLE_ROW.test(lines[j]!) && !TABLE_RULE.test(lines[j]!); j++) {
        const cells = lines[j]!.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean);
        if (cells.length > 0) out.push(`${++n}. ${cells.join(' — ')}`);
      }
      i = j - 1;
      underHeading = null;
      section = false;
      continue;
    }

    const heading = line.match(STEP_HEADING) ?? line.match(NUMBERED_HEADING);
    if (heading) {
      out.push(`${heading[1]}${heading[2]}. ${heading[3]!.replace(/\*\*/g, '').trim()}`);
      underHeading = `${heading[1]}   `;
      section = false;
      continue;
    }

    const box = opts.chat ? line.match(GLYPH_BOX) : null;
    if (box) {
      out.push(`${box[1]}[${box[2] === '☐' ? ' ' : 'x'}] ${box[3]}`);
      underHeading = null;
      continue;
    }

    const bullet = line.match(BULLET);
    if (section && bullet && (sectionIndent < 0 || bullet[1]!.length === sectionIndent)) {
      sectionIndent = bullet[1]!.length;
      out.push(`${bullet[1]}${++bulletNo}. ${bullet[2]}`);
      continue;
    }
    if (section && bullet) {
      out.push(line); // a sub-bullet: details under the step above
      continue;
    }
    if (line.trim() === '') {
      out.push(line);
      continue;
    }

    if (HUMAN_SECTION.test(line.trim()) && line.trim().length <= 80 && nextIsBullet(lines, i)) {
      section = true;
      sectionIndent = -1;
      bulletNo = 0;
      underHeading = null;
      out.push(line.replace(/^(\s*)#{1,6}\s*/, '$1'));
      continue;
    }
    section = false;

    // A step heading's paragraph: context for that step, until the next list line or heading.
    if (underHeading !== null && !LIST_LINE.test(line) && !/^\s*#{1,6}\s/.test(line)) {
      out.push(`${underHeading}${line.trim()}`);
      continue;
    }
    underHeading = null;
    out.push(line);
  }
  return out.join('\n');
}

function nextIsBullet(lines: string[], i: number): boolean {
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j]!.trim() === '') continue;
    return BULLET.test(lines[j]!);
  }
  return false;
}

/** Services whose dashboards hold the steps assistants leave for you. */
const SERVICES =
  /\b(?:Vercel|Supabase|Stripe|Google Cloud|GitHub|GitLab|Cloudflare|Netlify|Lovable|Replit|App Store Connect|Firebase|Heroku|Render|Railway|Fly\.io|AWS|Azure|Resend|Sentry|Twilio|Auth0|Clerk|PostHog|Algolia|DNS)\b/;
/** UPPER_SNAKE env names: at least two parts. */
const ENV_NAME = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;
const URL_OR_PATH = /\bhttps?:\/\/\S+|(?:^|\s)\/[a-z0-9_-]+(?:\/[a-z0-9_:.-]+)+/i;
const DASHBOARD_PATH = /\b\w[\w ]{0,30}?(?:\s[›>]\s\w[\w ]{0,30}\w)+/;
/** Things only you hold or set up: named precisely, so "the token line" in a note is not one. */
const KEY_WORD =
  /\b(?:api keys?|signing secret|client secret|webhook (?:endpoint|secret|url)|redirect ur[il]s?|callback url|dkim|cname|a record|dns record|oauth (?:client|app)|client id|deploy key|access token)\b/i;

/**
 * What a step acts on, when it names one: an env name, a URL or callback path, a dashboard path
 * ("Authentication › URL Configuration"), a key word, a known service, or a command in backticks.
 * Such a step is yours to do even without a known verb at its start. Null when it names none.
 */
export function stepTarget(title: string): string | null {
  const code = title.match(/`([^`]{3,160})`/)?.[1];
  if (code) return code;
  return title.match(ENV_NAME)?.[0] ?? title.match(URL_OR_PATH)?.[0]?.trim() ?? title.match(DASHBOARD_PATH)?.[0]
    ?? title.match(KEY_WORD)?.[0] ?? title.match(SERVICES)?.[0] ?? null;
}
