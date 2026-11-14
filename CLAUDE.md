# Didja

A local-first macOS menu bar app that captures pending to-dos from what is on screen and ticks them off when it sees them done. Read [README.md](README.md) and [docs/GUIDE.md](docs/GUIDE.md) for the product, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it works, [docs/ROADMAP.md](docs/ROADMAP.md) for what is planned, [docs/CHANGELOG.md](docs/CHANGELOG.md) for what was built and [docs/DECISIONS.md](docs/DECISIONS.md) for why.

Development work is tracked in Linear (key `SCR`). On the maintainer's Mac, `docs/AUTOPILOT.md` (kept out of the repository) holds the rules for picking issues up automatically; follow it when it is there.

## Layout

- `app/` — Xcode project. `app/Capture/` is the capture layer (Accessibility, OCR fallback, differ, privacy); `app/Didja/` is the menu bar app, popover, task window and the SQLite reader/writer; `app/DidjaTests/` the tests.
- `engine/` — TypeScript on Bun. Reads observations, writes tasks, owns every rule about tasks. Compiled to one binary and bundled in the app at `Contents/Helpers/didja`.
- `schema/` — numbered SQL steps, applied by both the app and the engine.
- `profiles/` — one JSON file per chat or email app (how capture labels it), with made-up fixtures in `profiles/fixtures/`; see `profiles/README.md`. Bundled into the app; read by capture and the engine.
- `site/` — didja.dev, the landing page (Astro, static, Cloudflare Pages). Copy lives in `site/src/content.ts`; see `site/README.md`.

## Commands

```bash
# engine
cd engine && bun test && bunx tsc --noEmit

# app (builds, bundles the engine, runs the Swift tests)
xcodebuild -project app/Didja.xcodeproj -scheme Didja -configuration Debug -derivedDataPath app/build test

# restart the running app on the new build
pkill -f "Didja.app/Contents/MacOS/Didja"; pkill -f "Didja.app/Contents/Helpers/didja"
open app/build/Build/Products/Debug/Didja.app

# a build for other people: Developer ID, notarised, stapled, in dist/*.dmg
scripts/release.sh

# is capture running?
app/build/Build/Products/Debug/Didja.app/Contents/Helpers/didja status
```

`xcodebuild` prints thousands of lines; send it to a file and grep for `error:` and `** TEST`. The engine build leaves `engine/.*.bun-build` temp files; delete them, never commit them.

## Hard rules

- No Screenpipe or any third-party screen recorder. Capture uses Apple APIs only.
- Never store screenshots or video. OCR frames are processed in memory and dropped.
- Store text only, deduped per window. Observations expire after 24 hours.
- The exclude list applies before anything is read. Never read secure text fields. Evidence holds descriptions written by the engine, never raw screen text. The one exception, chosen by the maintainer: an email task's note keeps the email's sender name and subject, so you can see who asked (docs/DECISIONS.md).
- The second exception, chosen by the maintainer (SCR-31): a few lines around each open task (at most seven, as text) are kept with it in `task_context`, so you can see how it looked where it was captured. They go when the task is done or dismissed, with Forget Captured Text Now, and when their window is excluded.
- The third exception, chosen by the maintainer (SCR-42): **Report a Problem with This Window…** builds a diagnostics file from the window you were last in (its outline, the lines capture keeps, the lines kept from that app, its tasks), after the same exclude-list checks as capture, in memory. Every letter is x and every digit 0 (`Redactor`) unless you choose to show a line as it is. Didja never sends it and never saves it on its own: you save it, copy it, or (with `didja mcp` on) give it to your own Claude.
- Nothing leaves the device. No network calls, no analytics, no new dependencies that phone home. The one exception besides Connections, chosen by the maintainer (SCR-33): Sparkle's update check, once a day to https://didja.dev/appcast.xml (only the app's version), off in Settings › General, never in Debug builds or tests; an update installs only with a valid EdDSA signature. The model in use is Apple's on-device `SystemLanguageModel`; never the framework's Private Cloud Compute model. The one exception, chosen by the maintainer: a model in **Ollama on this Mac**, off until turned on in Settings › General (`meta.local_model`), asked first for emails, "looks done?" and who a list is for only (the jobs measured in `engine/eval/ollama.ts` and `engine/eval/lists.ts`), reached only at 127.0.0.1 (`LocalModel.swift`), with Apple's model as the fallback. Another job may use it only once it has made-up samples and measures better with no new wrong ticks.
- The second exception besides Connections, chosen by the maintainer (SCR-42): **`didja mcp`**, the engine's local MCP server for the user's own Claude (stdio, no network of its own). Off until turned on in Settings › General (`meta.mcp_enabled`). It serves only the reports the user gave it, masked kept text (`mask`, the same words as `Redactor`), masked `why`, the profiles, drafting profiles into its own folder, and a GitHub issue about a miss (`draft_issue`: masked by Didja, Claude's own words checked for screen text, given back as text and a link the user opens; Didja posts nothing); it logs every call (`mcp-log.jsonl`, shown in Privacy). What it returns goes to the user's AI provider; see docs/AGENTS.md.
- The third exception besides Connections, chosen by the maintainer (SCR-88): **agent hooks**. Off until turned on per tool in Settings › General › Assistants (`meta.agent_hook_<tool>`). On adds an entry to that tool's user-level hooks file (Claude Code `~/.claude/settings.json`, Cursor `~/.cursor/hooks.json`, Windsurf `~/.codeium/windsurf/hooks.json`; never a repository's; backed up first) that runs the bundled engine as `didja hook <tool> <event>` (no network). It keeps only the tool, event, time, a shell command line and exit code, and plan item titles (`agent-hooks.jsonl`, 24 hours, listed in Privacy); never file contents, prompts, responses, output or transcripts. Used only to take back steps that tool ran itself or keeps as its plan; it never ticks a task.
- The one exception, chosen by the maintainer: **Connections**. The engine may talk to the task tools you connect (over their MCP servers), and only to them: it reads your items there and writes back the state or label change for an item it ticks. Never screen text, observations, evidence or tasks from any other source. Every connection is listed in Privacy.
- A missed tick is cheap; a wrong tick is the bug this app exists to prevent. When a change could make ticking looser, add the test that shows it does not tick wrongly.

## Personal content (the repository is public)

- Anything from an issue, a screenshot, a chat or an email you were shown is private input: use it to understand the problem, never copy it. That covers names, chat and conversation titles, email subjects and addresses, message wording, phone numbers, company and client names, and usage figures from the maintainer's Mac.
- Tests, fixtures, docs, code comments, commit messages and the CHANGELOG use made-up equivalents with the same shape: "Sam", "Noa", "מייק", `example.com`, "Acme". A Hebrew WhatsApp chat in a screenshot becomes a made-up Hebrew chat with the same structure.
- Never commit a screenshot. Images come only from `brand/` or from renders the tests draw from made-up data (`docs/images`). Never commit a database or an export of one. The one exception, chosen by the maintainer: the demo recording on didja.dev (`site/public/media/didja-demo.mp4` and its poster), made in a made-up repo with Didja on an empty list and reviewed frame by frame before it was committed. A new recording gets the same review.
- Refer to the maintainer as "the maintainer", not by name.
- Conversations with the maintainer, and Linear issue text written from them, are private input too. Never quote their words or retell the story behind a change (who tried it, on whose Mac, what they did that day) in code, docs, the CHANGELOG, DECISIONS, commit messages or anything else public. State what changed and the product reason in your own neutral words; "the maintainer chose" is enough when a choice needs an owner.
- The git hooks in `.githooks/` (`git config core.hooksPath .githooks`, once per checkout) block a commit or push that adds a private name, a real email address, a phone number, a screenshot or a database, and run gitleaks. The private names come from Didja's own database on the maintainer's Mac and are never in the repository (`scripts/privacy_check.py`). If a hook blocks you, change the content; never use `--no-verify`. CI runs the same check without the names.

## Conventions

- Rules about tasks (grouping, ticking, snoozing, completion) live in the engine only. The app reads tasks from SQLite and changes them by running the bundled engine.
- Schema changes are a new `schema/NNN_name.sql` ending in `PRAGMA user_version = N`, imported in `engine/src/store.ts`, and added to the version list asserted in the Swift store test. Additive only.
- Every behaviour change comes with a test. Pure logic is kept separate from Accessibility/SQLite calls so it can be tested (`AXCapture.lines`, `Differ`, `TaskBoard`, `extract.ts`, `match.ts`).
- UI changes: the test `testRenderPopoverList` draws the popover to `$TMPDIR/didja-ui/popover.png`. Look at it.
- The app is signed with an Apple Development certificate so its Accessibility permission survives rebuilds. Do not change signing settings.
- Update README.md and docs/ (the feature detail is in docs/GUIDE.md) when behaviour changes. Commit in small logical commits with plain messages.
- Every change adds an entry to `docs/CHANGELOG.md` (newest first: what changed, and what was not verified). Every choice made in conversation or review that the code does not explain goes in `docs/DECISIONS.md` with its reason. Both in the same commit as the change.
