# App profiles

How Didja reads each chat and email app: which parts of its window are a message, who sent it and when, or an email's header. One JSON file per app or site. Adding an app needs no Swift: write a profile and a fixture, run the tests, open a pull request.

A profile can only **label** text in the window Didja is already reading. It cannot read another app, a password field or the message you are typing, turn off the exclude list, run code, or reach the network. Those checks run before any rule does, so even a wrong or hostile profile cannot get past them.

## AI tools (`profiles/assistants/`)

Which windows are an AI tool, and how to read them, are profiles too (SCR-83): one file per tool in `profiles/assistants/`, read by the engine, with made-up fixtures in `profiles/fixtures/assistants/` (checked by `engine/test/assistants.test.ts`). `didja profiles` lists them. A tool's profile cannot read anything new: it only says that a window Didja already reads is that tool.

```json
{
  "$schema": "../schema/assistant.schema.json",
  "id": "codex",
  "name": "Codex",
  "kind": "terminal",
  "about": "OpenAI's Codex CLI…",
  "match": { "terminal": { "titles": ["(?i)^codex\\b"], "signatures": [">_ OpenAI Codex"], "together": [["^\\s*• Ran ", "^\\s*└ "]] } },
  "turns": { "userPrompt": ["^\\s*› "], "reply": ["^\\s*• "] },
  "agentWork": { "approval": ["Would you like to run the following command\\?"], "ran": ["^\\s*• Ran "], "todo": ["^\\s*(?:└\\s+)?[✔□]\\s"] }
}
```

- `kind`: `chat` (an app or site you talk to), `terminal` (an agent in a terminal) or `editor` (an agent's panel in an editor).
- `match`: `bundleIds` (its own app), `hosts` (its site and subdomains), `terminal` and `editor`. Inside a terminal: `titles` (the tab title), `signatures` (any one is enough) and `together` (weak signs that count only all at once, such as a "●" reply with a "❯" prompt). Inside an editor only `signatures` and `together` of the agent's own panel count, never a title or a document's words. A title beats a signature, which beats weak signs together; then lower `order` (default 100), then file name.
- `turns`: `user` and `assistant` labels ("You said:", "ChatGPT said:"), and for terminals `userPrompt` and `reply` prefixes. `whenUnlabelled`: what to do with a chat window showing no labels or message sections: `assistant` (default, read it as the assistant's) or `ignore`.
- `agentWork`: lines that are the agent's own work: `approval` prompts (the question and its options), `ran` lines ("• Ran npm test", "● Bash(…)", "✔ Shell …", "Ran `…`"), the answer that `declined` a prompt ("› 2. No, and tell Codex…", "Skipped", "[Yes]: n"), and its `todo` list or plan heading. A list under a `todo` heading is never yours, nor are its items. A step whose command the agent then ran (an approved prompt, or a ran line naming it) is taken back as the agent's; a command you declined becomes your task (SCR-85, `engine/src/agents.ts`).
- `steps`: step shapes only this tool writes (`nameThenCommand`: Claude Code's "1. Folder" with the command under it).
- `sourceKind`: what its tasks' source is called; the id when left out.

Patterns are JavaScript regular expressions (multi-line, Unicode), with the same limits as above: at most 300 characters, no back-references or look-behind, no repeated group that repeats inside; `(?i)` at the start ignores case. A fixture (`profiles/fixtures/assistants/<name>.json`) is a window (`app`, `bundle`, `title`, optional `url`), its made-up `lines`, and `expect.assistant`, the profile id it must be recognised as, or `null` for a window that is no AI tool. An agent's fixture may add `expect.agent`: the commands it `ran`, the ones you `declined`, and its `todos` (`engine/test/agents.test.ts` checks them).

## Where steps are done (`profiles/done/`)

Where common steps are done and what an item looks like there (SCR-86): one file per service in `profiles/done/`, read by the engine (`engine/src/done.ts`), with made-up pages in `profiles/fixtures/done/` (checked by `engine/test/done.test.ts`; every place needs one that finds a step done there, and near-misses that must not).

```json
{
  "$schema": "../schema/done.schema.json",
  "id": "vercel",
  "name": "Vercel",
  "hosts": ["vercel.com"],
  "places": [
    { "id": "vercel-env", "name": "Vercel › Environment Variables", "kinds": ["env"], "path": "/settings/environment-variables(?:/|$)",
      "environments": ["Production", "Preview", "Development"], "form": ["^Key$", "^Value$", "^Save$"],
      "followUp": { "title": "Redeploy on Vercel so the new value is used" } }
  ]
}
```

- `hosts`, then per place a `path` pattern or `page` words (a line on the page): which page it is. `names`: other names a step may use for the service; the step or its source must name it.
- `kinds`: what a step targets there: `env` (a name), `url`, `domain`, `visibility` (public or private), `dns` (a record's type and name), `provider`, `deployment` (a redeploy).
- `after` / `before`: the list's heading, and what ends it. `confirm`: a line that must be within four lines after the item ("^Enabled$"). `saved`: a line that must be on the page (a list that is also a form: "OAuth client saved"). `form`: a line just above the item that means a form still being filled in. `environments`: the environments a row shows; a step naming one needs it on the row. `followUp`: a step a change here implies.

A fixture is the `step`, the `page` (`url`, made-up `lines`) and `expect.place`: the place id that finds it done, or `null` for a near-miss.

**Terminals are not profiles.** How a terminal's text is read (prompts, commands, their output and how each ended) is code, in one place: `engine/src/terminal.ts` (SCR-69). It knows zsh, oh-my-zsh, starship-like, bash and fish prompts. A prompt it does not know means a command there is not ticked; open an issue with a made-up example of the prompt. An editor's built-in terminal (VS Code, Cursor, Windsurf) is marked `⟦Terminal⟧` by capture while it has focus.

## How to add an app

1. **See what Didja sees.** Open the app on a conversation, then choose **Report a Problem with This Window…** in Didja's "…" menu. The preview shows the window's outline with every letter and digit masked. Save it.
2. **Write the profile** (`profiles/<id>.json`, below). The outline shows which roles, ids (`id=`), DOM ids (`dom=`) and class names (`class=`) mark each message, sender and time.
3. **Write a fixture** (`profiles/fixtures/<id>-<case>.json`). Copy the outline's shape, then **make up all the text**. Use names like Sam, Noa or Ron, and `example.com`, and keep the punctuation and layout. Never paste real messages, names or addresses: the privacy checks refuse them.
4. **Try it.** Run the fixture through capture:
   ```bash
   app/build/Build/Products/Debug/Didja.app/Contents/MacOS/Didja --profile-test profiles/fixtures/<id>-<case>.json --profiles profiles
   ```
   It prints the lines capture keeps. When they are right, put them in the fixture's `lines`. Then run the engine's check, `cd engine && bun test test/profiles.test.ts`. It prints what the engine makes of the lines; when that is right too, put it in `expect`.
5. **Run all the tests** (see [CONTRIBUTING.md](../CONTRIBUTING.md)) and open a pull request.

With your own Claude: `didja mcp` lets Claude Code or Claude Desktop do steps 2 to 4 with you: read the outlines you saved, draft the profile and fixture, and run the test. See [docs/AGENTS.md](../docs/AGENTS.md).

## A profile

```json
{
  "id": "acme-chat",
  "name": "Acme Chat",
  "kind": "chat",
  "status": "communityNew",
  "about": "Acme Chat for Mac. Each message is a group with id message-N holding its sender, time and text.",
  "match": { "bundleIds": ["com.example.acmechat"] },
  "rules": [
    { "is": "chatName", "where": { "identifier": "conversation-title" }, "chat": "title",
      "groupIf": { "class": ["is-group"] } },
    { "is": "message", "where": { "role": ["AXGroup"], "identifier": { "prefix": "message-" } },
      "from": { "of": { "class": ["sender"] } },
      "time": { "of": { "class": ["time"] }, "attr": ["description", "text"] },
      "body": { "class": ["text"] } }
  ]
}
```

- `$schema` (optional): `"./schema/profile.schema.json"`, for an editor that checks JSON.
- `id`: lowercase letters, digits and dashes; the file is named after it.
- `name`: the app's name, shown on its tasks ("Acme Chat — Dana").
- `kind`: `chat` or `email`.
- `status`: `builtIn` (written by the maintainer), `communityNew` (new in this release) or `community`. The app marks a community profile as such.
- `about`: what the app is and how its window is laid out, for the next person reading the profile.
- `match`: `bundleIds` for a Mac app; `urlPrefixes` (starting `https://`) or `hosts` (exact, https only) for a site in any browser.
- `linkTargets`: `emailBody` (default) keeps where a link points only inside an email's body; `webArea` anywhere in a web area (Outlook for Mac, whose email body is one).
- `stripBidiMarks`: remove the invisible left-to-right marks some apps put around their labels.
- `rules`: tried in order on every element; the first that matches decides.

### Which elements: `where`

Every condition given must hold.

| Key | Matches |
| --- | --- |
| `role` | One of these roles: `["AXGroup", "AXHeading"]` |
| `identifier` | The element's `AXIdentifier` (`id=` in an outline) |
| `dom` | Its DOM id (`dom=`) |
| `class` | Any of these class names (`class=`) |
| `classPrefix` | A class name starting with this |

`identifier` and `dom` take a string (equal to it) or `{ "prefix": …, "suffix": …, "contains": [ … ] }`. In a `message` rule with `idAfter`, `$id` stands for the message's own id: `{ "dom": "author-$id" }`.

### What text: sources

Where a rule needs text (`chat`, `from`, `time`, `text`, `label`…), give a source. A plain string names the attribute (`"title"`); a list is tried in order until one gives text.

| Key | Meaning |
| --- | --- |
| `attr` | `title`, `description`, `value`, `help`, or `text` (everything under the element, read as usual). A list: the first with text wins. Default `text`. |
| `of` | Read from the first element under this one (itself included, 12 levels down) that matches. |
| `all`, `join` | With `of`: every match, joined (default `", "`). |
| `squash` | Collapse runs of white space. |
| `dropLabel` | Remove a leading label ("From: ", "Von: ") up to this many times, when its colon is in the first 14 characters. |
| `pattern` | Keep only what matches; its group `v` if it has one. Named groups fill a `line` template. |
| `trim` | Characters to trim from both ends, besides white space. |
| `reject` | No text when it contains any of these (ignoring case). |
| `contains` | Turns the source into a yes/no: yes when the text contains this (ignoring case). |

Patterns are ICU regular expressions with limits: at most 300 characters, no back-references (`\1`, `\k<…>`), no look-behind, and no repeated group that repeats inside (`(a+)+`, `(?:x*y)*`). Text is cut at 2,000 characters before it is matched. `(?i)` ignores case, `(?s)` lets `.` cross lines.

### Rules: `is`

| `is` | What it does | Needs |
| --- | --- | --- |
| `chatName` | Names the open chat, then reads the element as usual. `groupIf`: the chat is a group when this element matches, else direct. | `chat` |
| `message` | One message: its sender, time and body, then a page marker. A sender or time it cannot find carries on from the message before. | `from`, `body` (a `where`), optional `time`, `idAfter`, `unless`, `mentionsMe`, `myReaction` |
| `messageList` | A list whose items each describe a whole message in one label (WhatsApp). The label is read by `parse` steps. | `chat`, `item`, `label`, `parse`, optional `plainKinds`, `reactions` |
| `reactionList` | A list of chats whose rows show your own reaction ("You reacted 👍 to …"): each becomes a reply from you in that chat. | `rowChat`, `rowLabel`, `reactions` |
| `skip` | Leaves the element out (system notices). | |
| `line` | One labelled line from a template: `"From: {v}"`. With no text, the element is read as usual. | `text`, `line` |
| `emailHeader` | An email's header block: a section named after its first line, the subject. | |
| `emailSubject` | Remembers the conversation's subject, then reads the element as usual. | `text` |
| `emailSection` | Starts a numbered email section named after the element's text. | `text` |
| `emailMessage` | One email of a conversation: a numbered section holding its body, then a page marker. | |
| `emailBody` | An email's body, then a page marker. | |

`parse` steps, for `messageList`: each step matches a field against a pattern. Its named groups become fields, and `set` sets more. A step whose field is empty or does not match is skipped, unless it is `required`, which drops the label. `unless` skips the step when that field already has a value. The label starts as the field `label`. What counts: `time` and `text`, `from`, `kind` (any kind not in `plainKinds` is shown as "[photo] …"), and `mine` and `group` (set at all means yes). See `whatsapp.json`.

## A fixture

```json
{
  "about": "A group: Ron asks you by name and Dana, not you, says it is done.",
  "profile": "acme-chat",
  "app": "com.example.acmechat",
  "window": "Acme Chat",
  "outline": ["AXWindow", " AXGroup id=\"message-1\"", "  …"],
  "lines": ["⟦Chat message: Family (group) — from Ron — 9:50⟧", "Mike, can you pick up the cake?", "…"],
  "expect": { "messages": [ … ], "open": ["Answer Ron"] }
}
```

- `outline`: the window, one element per line, indented one space per level: the role (`AXGroup/AXDocumentArticle` with a subrole), then `id=`, `dom=`, `class=` (space separated), `title=`, `value=`, `desc=`, `help=`, `url=`, each a JSON string, and `focused` alone. A site's fixture puts its address on the `AXWebArea` (`url=`) and adds `"url"` at the top.
- `lines`: what capture keeps (checked by the app's tests).
- `expect`: what the engine makes of `lines` (checked by the engine's tests). For a chat, `messages` (who wrote each, in which chat, direct or group) and `open`, the asks left for you. The check's stand-in model ticks whenever it can, so a message wrongly taken for yours would answer an ask and drop it from `open`. For mail, `emails` (subject, from, to, date). The fixtures' "now" is Wednesday 11 November 2026, 10:00.
- Every profile needs at least one fixture, and a chat profile needs one where someone else answers in your place: that ask must stay open.

Write the text yourself. A fixture is public: it must hold no real names, messages, addresses or numbers.
