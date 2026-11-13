# Changelog

What was built, newest first. One entry per change that someone using the app or working on it would notice. The reasons behind choices are in [DECISIONS.md](DECISIONS.md); how it works is in [ARCHITECTURE.md](ARCHITECTURE.md); what is next is in [ROADMAP.md](ROADMAP.md) and Linear (team ScrolledAway, `SCR`).

Each entry says what changed, and what was **not verified** where that applies: tested only, or not yet seen on the live app.

## 2026-11-13

### Claude Code: steps Claude runs itself, tool output, and docs in an editor are not your tasks (SCR-65)
- An editor counted as Claude Code when its window title held "claude" (a CLAUDE.md) or its text said "Claude Code" or "⏺", so numbered rules in any open doc became tasks. Now an editor counts only when Claude Code's own panel is in it (its prompt hints: "? for shortcuts", "esc to interrupt", "shift+tab to cycle", the accept-edits and plan-mode lines). Terminals are unchanged.
- In Claude Code, the transcript is split: what you typed (`> …`), Claude's replies (`⏺ …`), and its tool calls with their output (`⏺ Bash(…)`, `⎿ …`). Only lists and commands in Claude's replies become tasks, so `cat` of a doc or a file Claude read makes none.
- A step Claude then carries out with its own tools is taken back with the note "Claude did this itself" (in why), never ticked as yours: a later `Bash(…)` running that step's command (alone or in a `&&` chain), or an `Update`/`Write`/`Edit` of the file a step to add, set, update, fix… names. Reading a file, another command, or a tool call before the list does not count.
- Tests: CLAUDE.md in Cursor makes no tasks; a Claude Code reply "1. Run `bun run migrate` 2. Set RESEND_API_KEY in the Vercel dashboard" where Claude then runs the migration leaves only the Resend step, with the migration dismissed and not ticked; `cat` of a doc makes no tasks; edits and commands match only the same file and command after the list. Three new benchmark scenarios (30 in all). Benchmark with no model, before → after on the same 30: precision 71% → 92%, recall 48% → 48%, wrong ticks 0. **Not verified:** the Claude Code panel in VS Code or Cursor on a live screen, whose captured text may not show those hints (it would then not be read as Claude Code at all).

### An end-to-end benchmark: made-up sessions replayed, capture and ticking measured (SCR-64)
- `cd engine && bun bench/run.ts [--model none|apple|ollama:<name>]` replays 27 made-up sessions (`engine/bench/scenarios/`) through the engine with a fake clock and prints, per scenario and in total, what became a task (recall, precision, tasks that must not exist) and what got ticked (ticked, asked, missed, **wrong ticks**, wrong asks, minutes from done to ticked). Labels say what really happened, not what the engine does today.
- The scenarios cover a Claude desktop checklist and Claude's own plan, claude.ai in a browser, Claude Code doing some steps itself and leaving others to you, a CLAUDE.md in an editor, terminal commands typed, run, failed, re-run and run in another window, Outlook approvals done in a browser and by a workflow response, an email reply, a GitHub visibility change, a Hebrew WhatsApp group answered by you, a Teams ask answered by someone else, a reply that puts things off, a newsletter and an FYI.
- CI runs it with no model after the engine tests; any wrong tick fails the job. `bun test` runs it too (`test/bench.test.ts`), with checks that every scenario is well formed and names only people from `profiles/fixtures/names.txt` and addresses at example.com or acme.com, and that the runner counts early, never-done and must-not-exist ticks as wrong. The baseline is in ARCHITECTURE.md ("How well it works").
- What the baseline shows (not fixed here): a numbered list of one step is never captured (`MIN_ITEMS = 2`), so a single "on your side" step is missed in Claude desktop, claude.ai and Claude Code; a CLAUDE.md open in an editor makes tasks of its rules; a command Claude Code asks you to run is not captured. Run once with Apple's on-device model on this Mac (recall 75%, 0 wrong ticks) and with no model (recall 46%, 0 wrong ticks). **Not verified:** Ollama was not run; model results vary between runs.

### A new "Done" or "Sent" is captured even when the same words are already in the window (SCR-63)
- Capture compared each line with the whole window, so a new chat reply "Done", "Sent", "Approved" or "👍" was dropped whenever an older message in the window said the same, and a command run again in a terminal was dropped because it was already on screen. The commonest completion words were the ones lost, so replies and re-runs never reached the engine.
- A line is now the same line only under the same section (the chat message or email it belongs to) and as the same occurrence: "Done" under a new message is new, a second "Done" under the same message heading is new, and a command typed again after its output is new, with its new output. A window seen again unchanged, or one that only scrolls older lines away, still adds nothing.
- Tests: Swift `DifferTests` for a new "Done" under a new message with an older "Done" on screen, a second identical line in the same section, a terminal re-run of `bun test`, and the same snapshot twice; engine tests that your reply "Done" ticks the ask it follows with an older "Done" of yours in the chat, and that the older "Done" before the ask never ticks it. **Not verified** on a live chat or terminal.

### Hebrew (and every non-Latin) task has a key of its own (SCR-62)
- The key that tells one task from another kept only a–z and 0–9, so every Hebrew title had an empty key. One "Not an Action" on a Hebrew chat task then silently dropped every later Hebrew task, and different Hebrew steps of a list merged into one. The key now keeps letters and digits of any script (lowercased, accents and points dropped). A title with no letters or digits at all (an emoji) is known by its exact wording and never matches another; no lesson is stored or matched under an empty key.
- Once, at start: lessons stored under an empty key by earlier versions are dropped (`empty_lessons_dropped`), so the "Not an Action" that blocked every Hebrew task stops doing so. Hebrew tasks already merged into one stay as they are.
- Tests (made-up Hebrew): "Not an Action" on one Hebrew ask blocks that wording only, not a different Hebrew ask or an English one; two different Hebrew steps stay two tasks and the same one seen again stays one; English is keyed and deduplicated as before; emoji-only titles match nothing but their own wording; an old empty-key lesson is dropped once. **Not verified** on the maintainer's Mac: whether such a lesson exists there.

### A command typed but not run, or a failed run, no longer ticks its task (SCR-61)
- Capture reads a terminal's input line, so `git push origin main` typed at the prompt but not entered ticked its task, and so did a run that failed. Now a command counts only when the same terminal window shows output or the next prompt after it, within 5 minutes, and none of that output says it failed (error:, fatal:, npm ERR!, command not found, `** BUILD FAILED **`, HTTP 4xx/5xx, curl errors, a rejected push, `[ERROR]`, a non-zero exit code, failed tests…), nor does the next prompt show a non-zero status (✘, `[1]`). A failed run neither ticks nor asks. Running it again and succeeding ticks it.
- Tests: typed and not entered, no tick; its output arriving in the window's next observation, tick; each failure line, no tick and no "looks done?"; the next prompt marked ✘ or `[1]`, no tick; run again after a failure, tick; output in another terminal window, no tick; output more than 5 minutes later, not counted. Three older tests that ticked on a typed command with nothing after it now show its output; three that must not tick now have output too and still do not. **Not verified** on a live terminal; prompts that put the command after something other than a prompt character (`➜ repo git:(main) …`) were not counted before and still are not.

### Your own Claude offers a GitHub issue after it finds a miss (SCR-57)
- `didja mcp` has a new tool, `draft_issue`, and now gives your Claude instructions when it connects: once it has found why Didja missed or misread something, offer to report it as a GitHub issue, show you the whole draft, and post nothing without your yes.
- Didja writes the issue: a fixed template (fingerprint, app and profile, versions, what was missed, what capture kept, likely cause, suggested fix). It knows the app, bundle id, profile and versions; what capture kept is masked by Didja, a report too (masked again, lines you chose to show included). Your Claude adds only its explanation, which Didja checks: a word from your screen or tasks, an email address, a link with a path or a number of three or more digits, and nothing is drafted.
- It gives back the title and body, a link that opens the issue form filled in (or the bare form and the body to paste, when it is too long for a link), and a search for issues with the same fingerprint (`<bundle id>:<miss type>`, such as `com.example.Mail:place-missing-no-address`) so your Claude can add to one instead.
- New issue forms `missed-task.yml` and `app-support.yml`, with the same fields. AGENTS.md, CLAUDE.md (the `didja mcp` exception) and Privacy say what it does.
- Tests (made up): a clean draft has no name, subject word, number or address of the user's, only masked lines and label words; screen words, an address, a link with an id, a long number and a free-text miss type are refused; a long body is given to paste; a report's shown line is masked again; the forms' field ids match the link. **Not verified:** a real Claude Code or Claude Desktop session ending a diagnosis with the offer, and the link opening the form on GitHub (needs the forms on `main`).

### Your response to a workflow approval ticks its task (SCR-55)
- An approval from an approval workflow (Oracle EBS and the like) stayed open after you approved it: its Approve link sends a new email to the workflow, not a reply, so nothing linked it to the task. Now an email of yours with the request's exact subject and a `Response Action: '…'` line ticks the task, in the same mail app. Approve, Reject or Forward all count. The why says which response ticked it; reopening it stops that response ticking it again.
- Tests (made up): Approve and Reject tick. None of these tick: the workflow's own mail with the line, a colleague's response, your note with the same subject but no response line, your response to another order, your response seen in another mail app, or the same response after you reopened the task.
- Not changed: "looks done" still checks only screens on an app or site the task names, so the Sent screen of an "Approve purchase order" task is not shown to the model; this rule covers that case instead. **Not verified** on real workflow mail: the line's exact wording in your Sent view is taken from the issue.

### Didja Missed This always offers the app the task came from (SCR-54)
- A screen with no web address (Outlook for Mac, Finder, Notes) was already a place of its own, named by its app; what hid Outlook was the 8-place limit, lifted the day before. One gap was left: with more than 16 apps used since the task, the task's own app could still be cut. It now always keeps a place, still in order of when you were last there (a Claude step's own app still goes last). Picking a place only lets its screens be shown to the model; nothing ticks more loosely.
- Tests: an email from Outlook (no address), then 20 other native apps, still offers Outlook with its Sent screen, and only one other app makes way for it. **Not verified** in the live window.

### The repository is public
- `didja-dev/didja` is public, with one first commit (the history before it stays private). `main` is protected by a ruleset: pull requests with a code owner's review and passing checks (`check`, `engine`, `app`, `dco`), no force pushes or deletion; repository admins and deploy keys may push past it. Secret scanning with push protection, private vulnerability reporting (SECURITY.md now points to it), approval before first-time contributors' workflows run, and Dependabot alerts are on.
- The release workflow pushes its appcast commit with a deploy key (`APPCAST_DEPLOY_KEY`), since a ruleset cannot let GitHub Actions itself through. **Not verified** until the next release runs.

## 2026-11-12

### Didja 0.5.0 (build 6)
- Released from GitHub: v0.5.0 is in `didja-dev/releases` (notarised, stapled). The workflow's site deploy went to a preview, since it runs on the tag and wrangler took the branch to be "HEAD"; it now deploys with `--branch main`, and this release's appcast was deployed from `main` by hand.
- The release build is signed ad hoc before being re-signed with Developer ID (`scripts/release.sh`), as the CI tests already were: the first run on GitHub stopped because its machine has no Apple Development certificate. Checked: a Release build this way succeeds on the maintainer's Mac.
- The first release built on GitHub (`release.yml`, on a version tag): signed with Developer ID, notarised, its update signed with the Sparkle key, uploaded to `didja-dev/releases`, the appcast updated and didja.dev deployed. Everything above since 0.4.1 is in it: a model in Ollama for emails and "looks done?", keys for canvases, Didja Missed This offering every app, archive matching by subject without status tags, and New Messages Only reading every Claude reply.

### Release builds on GitHub use macOS 26
- `release.yml` ran on `macos-15`, whose Xcode has no FoundationModels: a build made there would have compiled without Apple's on-device model (the code is guarded by `canImport`). It now runs on `macos-26`, like the app tests. **Not verified:** no release has run on GitHub yet (its secrets are not set).

### Archiving the follow-up email takes the task off the list too
- An archive matched only an email with exactly the same subject, so archiving the workflow's "Closed: Purchase Order 4410…" left the "Action Required: Purchase Order 4410…" task open. An archive now also matches an email about the same matter: the same subject once a status tag in front ("Closed:", "Action Required:", "[External]", up to two of them, each one to three words) is set aside, when what remains is at least 20 characters. A different order number, or a short subject like "Lunch on Thursday", does not match. Still dismissed, never ticked.
- Checked against the maintainer's real purchase-order email and the archive Didja saw: it would have been taken off the list.

### Didja Missed This offers every app you were in
- "Where did you do it?" showed at most 8 places, with the app the task came from always last, so an email's own app (Outlook, where you approve or answer it) fell off the list, and so did apps behind many browser sites. Now each app you were in since the task gets a place before a second site of the same app, up to 16, and an email's or chat's own app keeps its place by when you were last there. A step from Claude still puts Claude last.
- Checked on the maintainer's Mac: an Outlook approval task now lists Outlook third, and the apps that were cut off before.

### "New Messages Only" leaves out only what is dated before capture started
- With **Older Messages: Ignore Them**, Didja now leaves out a mail or chat message only when its own date is before capture started (at launch, or when you last pressed Resume). The app records that moment (`meta.capturing_since`).
- A Claude reply has no date, so it is never left out: a checklist that came while you were in another window, or one you scroll back up to read, becomes tasks. Before, anything already in a conversation when Didja first saw it was dropped, so those were lost (the maintainer hit it).
- Email is now covered too: mail dated before capture started is not read (`mailTime` reads Gmail's and Outlook's dates). A date that cannot be told, like a chat time that cannot be read, is kept.
- Tests: Claude lists already there or scrolled back to are captured; chat asks and emails from before the start are not put to the model, newer ones are; with no start recorded nothing is left out; the dates mail apps show are read. The old first-view helpers are gone. **Not verified** on the maintainer's Mac until the app is rebuilt and restarted.

### didja.dev: downloads from the releases repository, and a true privacy answer
- Download, the version under it and the release-notes links come from `didja-dev/releases`, where the signed builds are, instead of the code repository (which has no releases): Download gave a 404 and the version read "v[VERSION]". `/download` and `/releases` follow. Code links still go to `didja-dev/didja`.
- The FAQ's "Does anything leave my Mac?" no longer promises an "optional AI helper" that sends a redacted snippet (Didja has none). It now says what is true: nothing from the screen; Apple's model or your own Ollama model, both on the Mac; the daily update check; a task tool only if you connect one; and what your own Claude reads goes to your AI provider if you turn that on.
- Deployed and checked on https://didja.dev: v0.4.1 shown, /download gives the DMG, the new answer is there.

### Ready for a public repository
- A made-up surname in the email samples is now "Bar-Lev" (the privacy check took part of the old one for a private name). Test email addresses use `example.com` / `example.org` (two used real domains), and "workflow" and "+ 1" are on the privacy check's allow list (common words that ended up in the maintainer's private list).

### A model in Ollama, for emails and "looks done?"
- **Settings › General › Use a model in Ollama** (off by default): Didja asks a model in Ollama on this Mac first about emails and whether a screen shows a task done, and Apple's on-device model when Ollama does not answer. Pick the model in the same row; the row says when Ollama is not running or has no models. Privacy says when it is on. `didja local-model on <model> | off | status [--json]` from the command line.
- The engine keeps the switch (`meta.local_model`) and sends it with those two jobs only; the app's judge asks `127.0.0.1:11434` with the same instructions and prompts (`LocalModel.swift`). List judging, titles and chats stay with Apple's model.
- Checked with the built app: qwen3.8 answered both jobs, and called an unsent draft "notDone" where Apple's model said "done"; an unknown model fell back to Apple's model. **Not verified:** a day of real use with it on, and the Settings row by hand (the render test draws it with Ollama running and the switch off).

### Eval: a local Ollama model against Apple's on-device model
- `engine/eval/ollama.ts` runs the made-up email and "looks done?" samples through Apple's model (`Didja --needs-reply`, `--looks-done`) and through a model in Ollama on 127.0.0.1, with the same instructions read from `Judge.swift`. Nothing in the app uses Ollama; this only measures. With `SHAPE=words` the local model answers an email with reply/action/none.
- First run, qwen3.8 on the maintainer's Mac: email 14/14 (words) or 5/14 (Apple's answer shape: it picks "nothing" for how a task is done) against Apple's 11/14; looks done 10/10 with no wrong tick against Apple's 9/10 with one (an open draft taken as sent). About 2 s an answer against Apple's 0.5 to 1.5 s. **Not verified** beyond these 24 samples.

### didja.dev: the hero is Didja's real popover, and a Full View window
- The hero no longer changes size as it plays, so the headline beside it stays still (it re-centred itself each time "Looks done?" appeared). The ask's space is always kept; it fades in and out.
- The hero is now a Mac's top-right corner: the full menu bar (Apple menu, Terminal's menus, Wi-Fi, battery, Didja's icon pressed with its count, the clock), with Didja's popover hanging from the icon on its arrow, in the real popover's layout: header with Full View, search, a source line per app, a checklist with its pie and count, the "Looks done?" ask inline under the email, Recently done, and the Capturing footer with ⇧⌘J and Pause. A Terminal window behind it shows the migration Didja saw. On narrow screens the Terminal and the menus give way.
- New "Full View" section after How it works: Didja's big window drawn in the real one's shape (sidebar with Tasks, Sources, Settings and the capture status; the list grouped by source; the detail pane on a step left behind, with what would tick it and "Not an action"). Scaled to fit, made-up content.
- The page can no longer scroll sideways from the hero's highlighter stroke (`main { overflow-x: clip }`).
- Checked in the browser pane at desktop and phone width, then live on https://didja.dev: the headline stayed put and the hero kept its height while it played (the step ticked, the ask arrived), the Full View window fits, no sideways scroll, no console errors.

### didja.dev: a fuller hero, and the demo plays by itself
- The hero's Quick View is now the real popover's shape: Didja's header with the open count, search, and work from four places at once (a Claude Code checklist with its 2/4 count, a Gmail ask, a Slack question left 3h ago, a Linear item that ticks there too). Each tick says what Didja saw ("seen in Terminal · 9:20"), and a footer says it is capturing on this Mac only. Two notes on the frame's edges: a command seen in Terminal, and "text only · forgets in 24h · nothing sent". All made up.
- Once the hero is in view it plays a short sequence: a step ticks itself ("seen on supabase.com · just now"), then "Looks done — confirm?" arrives for the email. A click on anything stops it and leaves it to you.
- "See it" no longer needs scrolling: once you reach it, the Mac plays its five scenes by itself (about 4 seconds each, the last a little longer), loops, and pauses while out of view. A Pause/Play button and the captions control it. With reduced motion, nothing starts by itself.
- Checked in the browser pane at desktop and phone width: the sequence runs, scenes advance on their own, Pause holds, a caption jumps, no sideways scroll, no console errors. Then live on https://didja.dev: the hero step ticked itself, the ask arrived, the story moved on by itself, no console errors.
- The page now loads `site.js?v=<hash of its contents>`. The first deploy showed why: browsers keep the script for up to 4 hours, and a returning visitor got the new page with the old script (nothing played).

### didja.dev: a real recording under the drawn demo
- "See it" now ends with "Recorded on a Mac, not drawn.": 32 seconds of Claude answering a git question, the steps run in Terminal, and Didja's menu bar list ticking `git show-ref` and `git checkout main` as they run. 700 KB MP4 (1352 wide, 30 fps, no sound) and a poster still, both from this site's own host (the CSP is unchanged). It plays while in view, pauses when scrolled away, and waits for Play with reduced motion.
- Made in a made-up repo with Didja's data set aside and reviewed frame by frame (no names, the only path shown is `~/Documents/GitHub`). CLAUDE.md now names it as the one exception to "never commit a screenshot".
- Checked in the browser pane and then on https://didja.dev after deploying: the video is served as `video/mp4` (700 KB), plays when scrolled into view, the only script is `site.js`, no console errors; no sideways scroll at phone width (local preview).

### The model is told what you asked before Claude's list
- When the on-device model judges whether a list in Claude's reply is for you or is Claude's own plan, it now also gets the message of yours just above the reply ("How do I tag v0.2.0 and push it?"), and its instructions say that steps answering a "how do I" question are for you. Before, it saw only the steps: two git commands answering exactly that question were dismissed as "Claude's own plan" (seen live while recording the demo). Lists and commands both carry the question (`asked`); with none of your messages in view, nothing changes.
- Checked with the real model on this Mac: the same two steps were judged "assistant" without the question and "user" with it. Engine and app tests added. Ticking is unchanged: a step still ticks only when its command is seen run.

### didja.dev: no Cloudflare analytics script
- Cloudflare was adding its Web Analytics beacon (`static.cloudflareinsights.com`) to didja.dev's pages, though every analytics switch in the dashboard (the Pages project's Web Analytics, the zone's Real user monitoring) reads off and the account has no Web Analytics site. The page's CSP already blocked it, so nothing was collected, but browsers logged an error. Pages now send `Cache-Control: no-transform` (`site/public/_headers`), which tells Cloudflare not to change them.
- Deployed and checked on https://didja.dev: pages and assets carry `no-transform`, the only script is `site.js`, and the console has no errors.

### didja.dev: motion, and a Mac demo of Didja making didja.dev public
- The demo placeholder is now a story told on a Mac drawn in HTML and CSS, scrolled through in "See it": Claude Desktop gives five steps to make didja.dev public (push to `didja-dev/didja`, set the repo Public, connect it in Cloudflare Pages, add the domain, upload the social preview); Terminal shows the push, Safari shows GitHub's settings and Cloudflare's custom domains; Didja's menu bar icon counts down and its Quick View ticks each step with what it saw, asks "Looks done?" about the domain, and when a message pulls you away, nudges about the last step. Captions beside it (under it on a phone) follow the scene and take you to one when clicked. "How it works" shows three of the scenes as stills instead of placeholders.
- Motion in the spirit of roma.app, in Didja's own paper, ink and highlighter: a highlighter stroke behind the hero that draws as you scroll, the hero's marked words swiped in, headings lighting up from pencil to ink, cards rising in, a sticky blurred header, and a hero Quick View under a Mac menu bar. One script (`site.js`, replacing `mock.js`), no images, nothing from another host; with reduced motion nothing animates.
- The demo's words are new beyond Brand V1 (`story` in `content.ts`), made up apart from Didja's own names.
- Checked in the browser at desktop and phone width (all five scenes, the stills, no sideways scroll). Not deployed.

### Canvases from the keyboard
- From the line you type into, ↑ (when it is empty) goes into the list. There: ↑↓ move, **Space** ticks or unticks a task, **Tab** / **⇧Tab** indent and outdent, **⌥↑** / **⌥↓** move the item, **Return** (or E) edits it in place (a note's or heading's text, or a task's own name, through `didja rename`), **Y** / **N** answer "looks done?", **⌘⌫** takes it off the canvas (the task stays a task), **Esc** (or ↓ past the last item, or a click on the page) goes back to typing. **⌘W** closes the canvas. The highlighted item is marked and scrolled into view; the line at the bottom lists the keys. The row's menu has Rename (Return) or Edit (Return); "looks done?" shows (Y) and (N).
- Tests: 2 new (the keys map as the hint says; moving, ticking, indenting, reordering, editing, answering and removing go through the engine, a heading is never indented). Not verified: in the live canvas window.

### Claude Code counts as connected
- Didja Missed This… knew only Claude Desktop's settings: with Didja added to Claude Code (`claude mcp add`), it still said Claude did not know about Didja until Claude called it once. It now also reads Claude Code's settings (`~/.claude.json`: for all projects, or any one), and says Claude Code users paste the question (it is copied).
- Tests: 1 new (Claude Code's settings, for all projects and for one). Not verified: the window on the live Mac.

### Didja is in ⌘Tab while its windows are open; the Missed window scrolls; Claude Desktop added when it quits
- Didja is a menu bar app and joined the Dock and ⌘Tab only for the Full View. Now any titled window keeps it there (Didja Missed This, Report a Problem, Privacy, How It Decides, a canvas…), and it leaves when the last one closes or is minimised (`DockPresence`, watching windows open and close). The Quick View, under the icon or pinned, does not count.
- Didja Missed This… scrolls as a whole: after This Shows It Done, the added line pushed the rest out of reach.
- Claude Desktop rewrites its settings while it runs, and dropped Didja's entry (seen live, 15 minutes after it was added). Add Didja to Claude Desktop… now, while Claude is open, offers **Add When Claude Quits**: Didja adds the entry the moment Claude Desktop quits (remembered across restarts of Didja, `addToClaudeDesktopWhenItQuits`), so there is no need to quit it now. With Claude closed, it adds it at once.
- Tests: 2 new (which windows keep Didja in the Dock; the waiting stage). Not verified: ⌘Tab and the quit-time add on the live Mac.

### A taught place's word comes from the site, not the step
- A taught place also applied to steps naming a word, taken from the step itself: the first capitalised word, which for "Select Import holidays…" was "import", tying any step that mentions importing to that site. The word now comes from the site's own addresses (the most common first path segment there, "…/planner/…"), else from a word of the conversation's name that shows on those screens, and never from the step; with neither, the place applies only to that conversation's steps. Plumbing and UI words (main, admin, import, select, save…) never count. Didja Missed This… shows the word for the site you pick.
- Places taught before are given their word again once, from what is still kept there (`rewordPlacesOnce`, `meta.places_reworded`).
- Tests: engine 2 new (where the word comes from, the one-time reword), 1 updated; app 1 updated. Not verified: the reword on this Mac's place until the engine's next poll.

### What teaching a place changes, said before you choose; X opens Didja Missed This
- Under "Where did you do it?" the window now says, in the task's own terms, how Didja decides today (this step has nothing exact to look for, so only screens from apps and sites naming one of its words are shown to the model; the chosen site does not, so its N screens were never checked), what **Remember This Place** changes (new screens there are also shown to the model for the N other open steps of that conversation and steps that mention the app; you get "looks done?" to confirm, or it is ticked if Looks Done is set to Accept Automatically; nothing else changes), and when it is a good idea (you do these steps there) or not (an unrelated site: more "looks done?" questions, and more wrong ones). "Only Remember This Place" is now "Remember This Place".
- How It Decides lists the places you taught under Looks done, each said in words ("Screens on … are checked for steps from … and steps that mention …"), with × to forget it.
- **X** opens Didja Missed This… on the highlighted row, done tasks included; the right-click item shows (X), and the key line lists it.
- Engine: `didja missed` also gives the task's words, its conversation, how many of its steps are open, and whether looks done ticks by itself; `didja brain show` includes the places.
- Tests: engine 1 new and 1 extended, app 3 new (the explanation with this task's numbers, also when it ticks by itself or is already looked at; X; places listed and forgotten). Not verified: in the live app.

### Your Claude, connected for real, and asked with one click
- "Your Claude can read it now" was shown as soon as the switch was on, though no Claude knew about Didja (none had called it, and Claude Desktop's settings did not name it), and you were left to paste a prompt. Now Didja Missed This… says where you stand: **not set up** (Set Up Claude…: add to Claude Desktop, or copy for Claude Code), **allowed but not added** (Add Didja to Claude Desktop…, Copy for Claude Code), or **connected** (Claude Desktop names Didja, or a Claude has called it): **Ask Claude About This** opens Claude Desktop on a new chat with the question filled in (`claude://claude.ai/new?q=…`; it is put on the clipboard too).
- **Add Didja to Claude Desktop…** writes one entry, `mcpServers.didja` (the engine inside this app, `mcp`), into `claude_desktop_config.json` after asking; everything else in the file is left as it was and the old file is kept beside it as `.didja-backup`. A file that is not JSON is left alone. Claude Desktop reads it when it next starts.
- Tests: 2 new (added beside what is there, a backup kept, a broken file left alone; the stages). Not verified: that Claude Desktop fills in the question from the link, and Claude Desktop picking up Didja after a restart.

### Didja Missed This…, made for you first
- The window was a masked report, which left you with lines of x's and no next step (the maintainer). Now: **1 Where did you do it?** (the places you used since the task was captured, the most recent first and the app it came from last); **2 Which screen shows it done?** (the screens kept from that place, newest first, as they are: your own text, staying on the Mac), each with **This Shows It Done**; **3 Let your Claude help**; and, folded away, **Report it to Didja's makers**, the masked file as before.
- **This Shows It Done** ticks the task with that screen as its evidence ("You showed it done on …"), remembers the site, and at once looks again at the screens already kept there for the other open steps it applies to, so they can show "looks done?" without waiting (`didja missed <id> --done-at <screen>`, `lookAgainAt`). The window says what happened. **Only Remember This Place** teaches the site without ticking.
- **Let your Claude help:** with `didja mcp` on, **Give to My Claude** and **Copy a Prompt** (the prompt asks Claude to call the new `missed_report` tool, masked, sites kept); with it off, **Set Up Claude…** says what it means, turns it on and copies the Claude Code command.
- The masked list now has a key ("Hidden lines show as x… Click a line to put it in the file as it is") and **Show All** / **Hide All**, in Report a Problem too.
- Tests: engine 2 new (a screen shows it done: ticked with evidence, site taught, the rest looked at again and only suggested; the MCP tool masked), app 2 new (showing a screen runs the engine and says what happened; a render: looked at `missed.png`). Not verified: in the live app.

### Didja Missed This…, and folding by keyboard
- Right-click any task, open or done: **Didja Missed This…** makes a report about that one task, in the same masked preview as Report a Problem (Save, Copy, Open a GitHub Issue, Give to My Claude). It shows what would tick it (`why`), how it looked where it was captured, where Didja looks for it done, and every place Didja saw since it was captured, with screen counts, whether each was looked at, and its last lines. The site stays readable (it is what you teach); its path and all text are masked. The task's words never go in the file name or the issue link.
- **Where did you do it?** Pick one of those places and **Look There for Steps Like It**. Didja remembers the site (schema 021, `done_places`), and "looks done" from then on also checks that site for the other steps of the same conversation and for steps that name the same app (the first capitalised word, such as "Planner"). This only lets those screens be shown to the model: it must still see the step done, a screen anywhere else still does not count, and nothing is ticked by the place itself. `didja missed places` lists what you taught, `didja missed forget <id>` forgets one.
- Keys: ← on a step goes to its parent and ← again folds it; → on a folded parent unfolds it and → again goes to its first step; **⌥← / ⌥→** fold or unfold everything; **H** shows or hides Recently done in the Quick View.
- Tests: engine 5 new (the app word, a taught place only at its site and for its conversation or app word, before and after teaching (the model asked only after, the step only suggested), a taught place does not make the model say done, the report), app 5 new and 1 updated (outline moves, the keys, H and ⌥ arrows through the actions, the report masked with its own sections and nothing of the task in a link, a render: looked at `missed.png`). Not verified: on the live Mac.

### ⇧⌘J opens Didja
- The standard keys for the Quick View are now ⇧⌘J (were ⌃⌥S). Anyone who never changed them gets the new keys on restart; keys chosen in Settings › General stay. ⌃⌥P still pauses.
- Tests: the label, default and fallback updated. Not verified: no clash in every app (none known in macOS, Finder, Mail, Safari, Chrome, WhatsApp, Teams).

### The keyboard never gets stuck after the "…" menu
- Seen live: after choosing from the "…" menu, then +, the add field showed without the keyboard in it, and every key was ignored (they all belong to the add field while it is open), Esc included, until a mouse click. Now the Quick View takes the keyboard back when the menu closes; the add field asks for its window's keyboard when it appears; and if the field still does not have it, Esc cancels and any key you type is put in the field (`AddTaskField.takeKey`). Esc also cancels a rename that lost the keyboard.
- Tests: 1 new (a key typed while the field lacks the keyboard lands in it). Not verified: the sequence in the live Quick View.

### Keys for everything, and the "…" menu always opens
- The "…" menu stopped opening after the Quick View had closed while it was open: a SwiftUI menu inside the menu bar panel can stay stuck in its "open" state. It is now a native menu built each time it opens (`MoreMenu`, from `moreMenuEntries`), with the same groups.
- From the keyboard: **M** or **.** opens the menu; arrows, Return and typing work in it, and each item shows its key. **⌘1–⌘9** open canvas 1–9 and **⌘N** makes one, in the Quick View and the Full View; **⌘,** Settings; **⌘⇧⌫** Fresh Start…; **⌘⇧R** Report a Problem. With ⌃⌥S to open Didja, a canvas is two keys away.
- The Quick View shows your canvases in a strip under its header, numbered ⌘1, ⌘2…; they are numbered by when they were made, so a number stays the canvas it is. Hold ⌘ for a moment and the numbers light up and the key line switches to the ⌘ shortcuts (`CommandHeld`; a quick ⌘C does not flash them).
- Tests: 4 new (the menu's groups and keys, the native menu's ticks, keys and submenus, canvas numbers and keys, holding ⌘ against a shortcut). Not verified: the menu, the strip and the keys in the live Quick View.

### Alerts show the new icon, really (SCR-47)
- The Fresh Start alert still showed ScrolledAway's blue scroll. Every copy of Didja on the Mac carries the new icon, and an alert made in a test run used it; the stale one came from macOS's cached icon for `dev.didja.app`, cached when the first Didja builds still had the old artwork, and reloaded when Didja shows in the Dock (the Full View). Now every alert carries the icon itself (`AppIcon.alert`), and the icon is set again whenever Didja enters or leaves the Dock. The app's registration with macOS was refreshed on this Mac (`lsregister -f`).
- Checked every screen that shows the brand: the Welcome and Quick View lockups, the Settings mark and the menu bar icon are the brand's own files.
- Tests: 1 updated (an alert carries the icon). Not verified: the live alert after the restart.

### The "…" menu is grouped
- It had grown to 25 lines. Now: Canvases, Fresh Start… and Report a Problem at the top; **View** (Focus, Sort, Appearance, pin and keep open), **Tasks** (Looks Done, Older Messages, checklist reminders), **Privacy** (Privacy…, Exclude List…, Keep Captured Text For, Forget Captured Text Now…, the OCR permission when missing), **Help** (How Didja Works…, How It Decides…, Check for Updates…); then Settings…, Quit and the version. Launch at Login, Connections… and Your Names… left the menu: they are in Settings.
- Not verified: the live menu (looked at in code; the tests do not draw menus).

### Canvases: click and type, Markdown, levels (SCR-49)
- One line to type into, focused when the canvas opens and whenever you click on the page. Enter adds the line and clears it: the old "Add a task" field kept its text after Enter, because a field being typed in can keep its text when it is reset while handling the key. It is now cleared again once the field has finished.
- A typed line is read as Markdown (`parseCanvasLine` in the engine): `# ` a heading, `[] ` or `- [ ] ` a task (`[x]` one already done), `- ` a bullet note, `> ` a note; anything else is a task, or a note with the Task/Note switch beside the line.
- Levels: Tab and Shift-Tab indent the line you are typing (up to four), and so do two leading spaces; Indent and Outdent in an item's menu. A checklist's steps arrive one level in. Exports indent the same way (`  - [ ] …`). Schema 020 adds `canvas_items.level`.
- Notes show their Markdown: bold, italic, code and links.
- Tests: engine 2 new (Markdown lines and indents, levels kept and clamped), app 1 new and 1 updated (what is typed goes to the engine as typed, notes rendered). Run by hand with the engine on a scratch database: typed lines came out as the expected Markdown export. Not verified: typing, Tab and clicking in the live window.

### Canvases (SCR-49)
- A canvas is a floating page that stays open above your other windows while you work: right-click a task (or several chosen) › **Send to Canvas** › New Canvas or an existing one; a checklist goes as its title (a heading) and its steps. Add your own tasks, notes and headings on it; reorder with Move Up/Down; double-click a note to edit it. **Canvases** in the "…" menu opens one or makes a new one.
- A task on a canvas is the task itself: ticking it anywhere ticks it there, and Didja ticks it or shows "Looks done?" (Yes / Not Yet) from what you do, as in the list. Tasks added on a canvas are ordinary tasks (in the list too). Taking an item off a canvas, or deleting the canvas, never deletes a task.
- Export: Copy as Markdown, Save as Markdown or as text (headings, notes, tasks as `- [x]`).
- Engine: schema 019 (`canvases`, `canvas_items`), `didja canvas list | new | show | send | add | note | heading | edit | move | remove | rename | delete | export`, `canvas.ts` for the export.
- Tests: engine 5 (order, a task is the task itself, a checklist as heading and steps, notes edited but task items not, the exports), app 3 (read from the engine, every change through it, a render). Not verified: the floating window, menus and editing in the live app.

### Fresh Start, and My List by Siri (SCR-48, SCR-46)
- **Fresh Start…** in the Quick View's "…" menu marks every open and snoozed task done at once, after asking, so the list is clear. Nothing is deleted; **Undo Fresh Start** in the same menu, for a day, puts back exactly those tasks (snoozed ones snoozed), except any you changed since. Engine: `didja fresh-start [--undo | --status]`, `Store.freshStart` and `undoFreshStart` (what it did is kept in `meta.fresh_start`).
- **My List**: "Hey Siri, add to Didja" (or "add a task to Didja", "remind me in Didja"); Siri asks what, and it goes to My List, a list of its own. It's also in the Shortcuts app as **Add to My List** (`AddToMyListIntent`), and in the engine as `didja keep <title>`. A My List task stays until you tick it: nothing seen on screen ticks it or suggests it done, and Fresh Start leaves it.
- Tests: engine 3 new (Fresh Start leaves My List, undo puts back exactly what it did, a My List task is never looked at while the same words on an ordinary task are), app 3 (what Siri heard goes to the engine, the phrases, undo for a day). Not verified: Siri and Shortcuts on the live Mac (the app must have run once for Siri to learn the phrases); the menu items in the live app.

### Alerts show Didja's icon (SCR-47)
- An alert (Forget Captured Text Now…) showed the old ScrolledAway icon. The bundled icon was already the new one; macOS picked a stale icon for the menu bar app. Didja now sets its own icon from the bundled asset at launch (`AppIcon.apply`), which every alert and window uses. No other old name is shown anywhere; the remaining mentions are the one-time moves from ScrolledAway's data.
- Tests: 1 new (the icon comes from the bundle and is the brand's). Not verified: an alert in the live app after restart.

### Propose your instructions upstream (SCR-42, phase 5)
- How It Decides… has **Propose Upstream…** beside each job you changed. It shows your change against the built-in text as a line diff, lists your corrections for that job unticked (each holds a task's wording), takes an optional note, and makes one JSON file: Save…, Copy, or Open a GitHub Issue… to attach it. Nothing is sent.
- `engine/eval/compare.ts <file>` runs a proposal and the built-in instructions on the job's made-up samples through the built app's on-device model, and says take only if it gets more right with no new wrong ticks. New sample set: `engine/eval/looks-samples.json`, 10 made-up screens, half showing a task done and half not (a draft, a payment form, a page that only mentions the task). Lists and titles have no samples yet, so a proposal for them is not judged.
- Tests: 4 new (the diff, no correction included unless ticked, only your own version can be proposed, a render: looked at `proposal.png`). Run by hand: a loose looks-done proposal ("done whenever the task is mentioned") scored 7/10 against the built-in 9/10, with two new wrong ticks, and was refused. Not verified: the sheet in the live app.

### Your own Claude can help fix how Didja reads an app: `didja mcp` (SCR-42, phase 4)
- `didja mcp` is a local MCP server for Claude Code or Claude Desktop, off until **Let My Own Claude Read Didja** is turned on in Settings › General (`didja mcp on|off|status|log`). Its tools read the reports you gave it, the lines kept from an app and a task's why (both masked: every letter x, every digit 0, label words kept), the profiles, and draft a profile with fixtures into its own folder and test them through the app's capture and the engine.
- Report a Problem gains **Give to My Claude** while it is on: the file as you left it goes to `Shared with Claude/`. Privacy has a "Your own Claude" section with the number of calls and the last one; every call's tool and shortened arguments go to `mcp-log.jsonl`.
- `docs/AGENTS.md`: how to set it up, what Claude can see, and the rules it follows (show the user every file before it leaves the Mac, made-up fixtures only, a must-not-tick fixture for chat apps, profiles and fixtures only). The fixture logic the tests use moved to `engine/src/fixtures.ts`, so Claude sees what CI checks.
- Recorded as an exception in CLAUDE.md, with Connections and the update check.
- Tests: engine 258 (9 new: off refuses every tool, masking, the word list equal to the app's, kept lines and why masked, files only from their folders, drafting checked and confined, the log, a real stdio session; and the shape check), app 2 (sharing confined to its folder, the status words). Run by hand against the built app with a scratch database: `test_profile` ran a fixture through the app's capture and the engine, both matching. Not verified: Claude Code or Claude Desktop connected to it.

### Report a Problem with This Window… (SCR-42, phase 1)
- A new item in the Quick View's "…" menu makes a diagnostics file for the window you were last in: about (Didja and macOS versions, the app, its profile), the window's outline (roles, ids, DOM ids, class names and values, as `Didja --profile-test` and fixtures write them), what capture keeps from it now, the last 80 lines kept from that app, and its tasks with `didja why`. It reads the window once, in memory, after the same exclude-list checks as capture; secure fields show only their role, and the draft you are typing is left out.
- The preview shows the exact file. Every letter is x and every digit 0 (`Redactor`), except the words apps use in their own labels and Didja's own ("from", "Received", "direct"); ids keep their words but long mixed ids are masked whole; addresses keep only their site. Click a line to show it as it is, Mask All Again to undo. **Save…**, **Copy**, **Open a GitHub Issue…** (a new issue in `didja-dev/didja`, filled in except the file). Nothing is sent by Didja.
- Recorded as the third exception in CLAUDE.md; listed in Privacy under Your controls.
- Tests: 6 new (masking, the file masked until a line is shown and only that line, lines with nothing to hide, the issue link, the draft not copied, a render: looked at `diagnostics.png`). Not verified: the menu item and window on the live app with a real window.

### Profiles are checked on every pull request, and community ones are marked (SCR-42, phase 3)
- CI: `.github/workflows/test.yml` runs the engine's tests (including each profile's shape and each fixture's engine half) on every push and pull request, and the app's tests on macOS, ad-hoc signed, when the app, engine, schema or profiles change. `dco.yml` requires a `Signed-off-by` line from each commit's author in a pull request. `privacy.yml` also runs the new fixture check.
- `scripts/privacy_check.py fixtures`, also run by the hooks when a profile changes: a fixture may hold no text over 200 characters, no address of a real site (only example domains and the profiles' own sites), and no name that is not on `profiles/fixtures/names.txt`, the made-up roster.
- `.github/CODEOWNERS` asks the maintainers' team to review everything, profiles above all. CONTRIBUTING says how to support a new app, how to sign off, and who reviews.
- The Privacy window lists the apps read through a profile, marking community ones "(community)" and those new in this release "(community, new)".
- Tests: 5 new for the fixture check, 7 for profile shape in the engine, the Privacy summary. Not verified: the new workflows on GitHub, until they run; CODEOWNERS names a `maintainers` team that does not exist yet.

### Chat and email apps are read by profiles, not code (SCR-42, phase 2)
- What is particular to WhatsApp, Teams, Slack, Outlook for Mac, Gmail and Outlook on the web now lives in `profiles/<id>.json`: which elements are a message, its sender and time, an email's header, the reactions. Capture applies them through a fixed set of rules (`AppProfile.swift`); the per-app Swift (`WhatsAppChat`, `TeamsChat`, `SlackChat`, `OutlookMail`, `GmailPage`, `OutlookWeb`) is gone. The engine reads the same files for which windows are chats and which are mail (`profiles.ts`, `didja profiles`).
- The window walk runs on any element tree: a live window, or an outline written down as text (`OutlineElement`). Each profile has a fixture: an outline with made-up text, the lines capture must keep from it, and what the engine must make of them, including a case where someone else answers your ask and it must stay open. `Didja --profile-test <fixture.json>` runs one.
- A profile cannot read a secure field or the draft being typed, nor another app; its patterns are checked as it loads (length, no back-references or look-behind, no runaway repetition). `profiles/README.md` documents the format, `profiles/schema/profile.schema.json` is its JSON schema.
- Behaviour is meant to be unchanged. Tests: the old adapter tests' cases now run through the profiles as outlines (12 new Swift tests, 6 removed), 7 fixtures in both the app and the engine (8 new engine tests). Not verified: capture of each app on the live Mac after the change, beyond the bundled engine finding the profiles.

### The release workflow publishes to didja-dev/releases (SCR-33)
- `.github/workflows/release.yml` now creates the release and uploads `Didja.dmg` in the public `didja-dev/releases` repository, and the appcast's download links point there, matching how 0.4.0 and 0.4.1 were published by hand. It needs a new secret, `RELEASES_TOKEN` (a fine-grained token that can write releases in that repository only), listed at the top of the workflow.
- Not verified: the workflow has not run on GitHub (it needs a tag and its secrets). No app or engine change.

### A live chat is one task, and only if you leave it unanswered (SCR-45)
- A real case: a 20-minute back-and-forth in a WhatsApp direct chat made 10 open tasks, one per message, then marked most of them "looks done" one by one; one was a statement, not an ask, and some were worded "Tell <name> what he thinks".
- An ask now waits 10 minutes for a reply of yours in that chat; if you answer while the conversation goes on, it never becomes a task. If you don't, it becomes one after 10 minutes, even when the chat is no longer on screen (schema 018, `chat_pending`, keeps only the model's wording of it meanwhile).
- One task per conversation: further asks in the same chat join its open task, which is worded after the newest ask with "· +N", and one reply of yours settles them together (one "looks done" to confirm, not one per message). A new ask clears a "looks done" the task was showing.
- Chats that already have several open tasks are folded into one per chat, once, the next time the engine runs.
- The chat instructions: a statement about the sender (plans, wishes, offers) or something already answered is not an ask; a question is worded "Answer <name>: <the question>" (Hebrew: "ענה ל<name>: …"); vague wording such as "what he thinks" is refused.
- Tests: engine 235 (a live reply makes no task, 10 minutes without one makes one, several asks are one task and one reply settles it, another chat's reply or a reply that puts it off answers nothing, a new ask reopens the question, the one-time fold) and the app's chat instructions. Not verified: the new wording on real chats with the on-device model.

### The version is at the bottom of the "…" menu (SCR-44)
- The last line of the Quick View's "…" menu, under Quit, shows the version and build, for example "Didja 0.4.1 (5)". It is shown, not clickable. Settings › General uses the same label (`AppVersion`), which leaves out empty parts instead of showing "()".
- Tests: 2 new (the label from version and build, with either missing; the running app has one). Not verified: the line in the live menu.

### The two views are called Quick View and Full View (SCR-37)
- The panel under the menu bar icon is the **Quick View**; the big window is the **Full View**. Every place the app names them says so: the Quick View's header button is **Full View** (with the expand arrows), the Full View's way back is **Quick View**, the key lines say "O Full View" and "O Quick View", the menu items are "Pin Quick View (Move and Resize It)", "Unpin Quick View (Back Under the Icon)" and "Keep Quick View Open When You Click Elsewhere" (the "…" menu and the icon's right-click menu), and tooltips, Settings › General (Focus, Keys), Privacy, the Welcome window and the window titles ("Didja — Full View", "Didja — Quick View" when pinned) follow. The names live in one place, `ViewNames`.
- GUIDE, README and ARCHITECTURE use the new names; the code keeps panel/popover and task window, and settings saved under the old keys are unchanged.
- Tests: one new (both names, and no "panel" or "task window" left in the button, menu items or key lines); two updated to the new words. Looked at `panel.png` and `task-window.png`: both headers fit on one line.
- Not verified: the menus and the Welcome text in the running app.

### Buttons look like buttons, tags like tags (SCR-43)
- One rule: yellow marks things, it never means "click me". `app/Didja/DidjaStyle.swift` holds every button and tag look: `DidjaButtonStyle` `.primary` (ink fill, white text; paper fill, ink text in dark mode), `.secondary` (no fill, a 1 pt `#8A8980` / `#76756E` border), `.icon` (bare, 28 × 28), a small size (22 pt, 12 pt text), `DidjaLinkStyle` (ink, underlined on hover) and `TagView` (soft yellow, 12 pt semibold, does nothing). Every button: chip fill on hover, 8% darker when pressed, a 2 pt ink (paper) ring with a 2 pt gap for keyboard focus, 40% when disabled, at least 28 pt tall in the panel.
- Panel header: "81 open" is a 12 pt tag; **Expand** is an outlined button; + is an icon button, and the "…" menu has the same hover. Footer: **Pause**/Resume is a small outlined button instead of a blue link; "Grant Accessibility Access…" is an ink link; the ⌃⌥S keycap has a key's look (a border, heavier at the bottom, mono text).
- `QuietButtonStyle` is gone: its uses in the panel, task window, Settings pages, Welcome, Privacy, Exclude List and How It Decides now use the styles above. The task window's × is an icon button. The app's `AccentColor` asset is ink (paper in dark mode), so system toggles, default buttons and focus rings are no longer blue. No `.accentColor`, `.blue` or `.link` button style is left in the app.
- Brand tokens (`brand/tokens`, from `brand/source/generate.py`) gain `button-border`, `button-border-dark`, `tag-dark` and `chip-dark`; `brand/README.md` has the buttons-and-tags table.
- Contrast (WCAG ratio, light / dark): secondary text on the surface 17.6 / 17.3, on the hover fill 16.1 / 13.8; secondary border on the surface 3.4 / 3.9, on the hover fill 3.1 / 3.1; primary text on its fill 18.4 / 17.6; tag text on the tag 16.9 / 9.3. Text at least 4.5, borders at least 3; a test checks these.
- Tests: 5 new (which header and footer items are buttons, no button is yellow, the contrast above in both modes, the accent asset is ink and paper, renders of every kind plus Welcome and Settings › General in dark mode: `buttons.png`, `buttons-dark.png`, `welcome-dark.png`, `settings-dark.png`). No behaviour changed.
- Not verified: hover, pressed and the focus ring in the running app (the test renderer draws none of them), tabbing through the header with Full Keyboard Access, and system toggles taking the new accent.

### Releases are published in didja-dev/releases; version 0.4.1
- Signed DMGs go to the public `didja-dev/releases` repository (files only; the code stays private), because Sparkle and the site's Download button need a download that works without signing in, and Cloudflare Pages refuses files over 25 MB. The update list stays on didja.dev.
- 0.4.1 (build 5) is the first version offered as an update. Verified on the maintainer's Mac: an installed 0.4.0 found it with Check for Updates, showed its notes, installed it and relaunched as 0.4.1 without asking for Accessibility again. Not verified: a tampered download being refused, and the release workflow on GitHub.

### Version 0.4.0, with the real update key
- `SUPublicEDKey` in `app/Didja-Info.plist` is the real public key; the private key was made with Sparkle's `generate_keys` and stays in the maintainer's login keychain. Release builds now start the updater, and `scripts/release.sh` no longer refuses to run.
- Version 0.4.0 (build 4): the first release as Didja, with the brand, adding tasks, the source preview, the faster lists and updates.

### The maintainer is not named in the repository
- Every mention by name in CLAUDE.md, CHANGELOG, DECISIONS, site/README and a schema comment is now "the maintainer", with neutral pronouns; `LICENSE` is held by "the Didja authors". One more usage figure (a count of assigned issues) is gone.

### Nothing personal reaches the repository: rules, hooks and a CI check
- Rule (CLAUDE.md, "Personal content"; CONTRIBUTING): anything from an issue, screenshot, chat or email is private input, never copied; tests, docs, comments and commit messages use made-up equivalents; no screenshots or databases are committed; the maintainer is "the maintainer".
- `scripts/privacy_check.py` with git hooks in `.githooks/` (`git config core.hooksPath .githooks`): pre-commit checks what is staged, commit-msg the message, pre-push every commit being pushed and its message. They block private names, email addresses outside made-up and service domains, phone numbers, screenshots outside `brand/` and the rendered `docs/images`, and database files, and run gitleaks. A finding names the file and line and masks the name.
- The private names come from Didja's own database on the maintainer's Mac (chat names, senders, who asked or forwarded, conversation titles, your own names), plus an optional hand-kept list beside it; they are written to `private-terms.txt` in Didja's data folder, never to the repository. `scripts/privacy-allow.txt` lists app names and the made-up fixture names.
- `.github/workflows/privacy.yml` runs the same check on every push and pull request, without the private names, and runs the checker's tests.
- Its first run over the current files found two more real people in tests (a sender in the approval emails, a first name kept after a rename): both made up now.
- Tests: 10 for the checker (names from a sample database, Hebrew prefixes, addresses, phone numbers, files, a blocked and a passing commit in a scratch repository). Not verified: the CI workflow on GitHub.

### Personal usage and the maintainer's automation are kept out of the repository
- `docs/AUTOPILOT.md` (the maintainer's scheduled Linear task) is no longer tracked: it stays on the maintainer's Mac, ignored by git, where the task reads it. Its two decisions moved into it from DECISIONS.md; CLAUDE.md says to follow it when it is there.
- Real usage from the maintainer's Mac is gone from these docs: task and observation counts, which apps OCR read, a real payment-service email and a Hebrew email naming a real person (now a made-up example).

### Ready for a public repo, files only (SCR-35)
- Secrets: gitleaks 8.30.1 and trufflehog 3.99.8 over the full history (162 commits): no leaks, nothing verified or unverified.
- Real people and a private project are gone from the current files: the names from real chats and emails in tests, code comments and these docs are now made up (Sam Carter, Jordan Lee, Noa Katz / נועה כץ, Lena Hale), the private project is "Acme_Dashboard" and its host `dashboard.example.net`, and the maintainer is "the maintainer" or "Mike" in comments. The Names settings example and one Hebrew example in the email instructions use made-up names too; same cases, same results.
- The GitHub org is `didja-dev`: `ORG` in `site/src/repo.mjs`, the README's download link and the issue templates' security link. The site is not redeployed, because the repository is still private and the links would lead to a 404.
- `docs/images` are fresh renders in the brand (sample data only).
- Not done: older commits still hold the real names and an email address (a fresh history before going public drops them).

### The OCR fallback can be turned off in Settings (SCR-41)
- The alert in the issue ("Didja is requesting to bypass the system private window picker…") is macOS's own reminder for apps that use ScreenCaptureKit, not a Didja window. Didja calls ScreenCaptureKit in one place only, the OCR fallback, and only when the window in front has almost no Accessibility text (at most every 10 seconds). Nothing calls it at launch, so Didja itself doesn't bring the alert back on every restart.
- "Read windows without accessibility text" in Settings › General is now a switch when Screen Recording is granted (it was just "On"). Off, the fallback never runs and ScreenCaptureKit is never asked for anything. On by default, as before. The Privacy window says no picture is taken when it is off.
- Tests: when the fallback runs (permission, switch, a nearly empty window, the 10-second spacing), the switch's default and saving, and that switched off it returns nothing.
- Not verified: how often this Mac's macOS shows the alert. The system log has no record of it, and I can't see the screen. Rebuilding the Debug app many times a day may be what makes macOS ask again.

### Choose your own keys for opening the panel (SCR-40)
- Settings › General has a new Keys section: "Open the panel from anywhere" shows the current keys, **Change…** lets you press new ones (Esc cancels), and **Reset to ⌃⌥S** goes back. The choice is kept after a restart, and every place that names the keys (the panel's footer, Welcome, Settings) shows yours.
- Keys that can't work are explained and you can try again: a plain letter (it would take over typing; F-keys on their own are fine), ⌃⌥P (pause), keys macOS keeps (⌘Space, ⌘Q, ⌘Tab…), and keys another app already owns. The old keys stay until new ones are taken.
- Tests: labels, which keys are refused, saving and reset, a real hot key registered with the new keys and refused when already taken, and choosing keys (Esc, refused, accepted). I looked at the Settings render (`settings.png`).
- Not verified: pressing keys in the running Settings window. The pause key (⌃⌥P) can't be changed yet.

### The panel closes when you click elsewhere, and you can choose to keep it open (SCR-39)
- Clicking in another app or switching to one now closes the panel in every case: also when it is pinned, and also when opening it never made Didja the front app (another app coming to the front is now watched directly).
- New "Keep Panel Open When You Click Elsewhere" in the panel's "…" menu and the menu bar icon's right-click menu. Off by default. When on, the panel (pinned or not) stays until you close it with the icon, ⌃⌥S, Esc or its close button.
- Tests: when it closes and when it doesn't (`closesOnOutsideActivity`, `isOtherApp`), the setting is off by default and kept, and a real pinned panel closes when Didja stops being the front app and stays when kept open. The SCR-25 placement test now runs with "keep open" on, since the test host is not always the front app.
- Not verified: clicking into another app with the running app, and whether the exact case reported (panel opened from the menu bar, not pinned) was the pinned panel or the activation gap; both are covered.

### Licensed MIT
- `LICENSE` at the root; the README and didja.dev's footer say MIT. Not done: the live site still shows "[LICENSE] licensed" until it is deployed again.

### The panel's way into the task window is an "Expand" button (SCR-38)
- The grey window outline in the panel's header looked like a folder. It's now a yellow **Expand** chip with expand arrows, in the same style as the task window's buttons. It does the same thing (O still works).
- Tests: the button is labelled and its symbol exists. I looked at the render of the whole panel (`panel.png`).
- Not verified: the button in the running app.

### Back to the panel from the task window (SCR-36)
- The task window's header has two new buttons at the right: **Panel** closes the window and opens the panel under the menu bar icon (or where you pinned it), and **×** closes the window. O does the same as Panel (in the panel, O opens the window), and the window's key line now says "O panel".
- If the panel can't be shown (its icon is hidden in a crowded menu bar and it isn't pinned), the window comes straight back with a beep.
- Tests: the close-then-show order and the fallback (`WindowExit.backToPanel`), the key line, and a render of the window (`task-window.png`).
- Not verified: clicking the buttons in the running app.

### The repository is ready to be made public (SCR-35)
- Secrets: the full git history (154 commits, every branch) was searched for keys, tokens, private keys, app-specific passwords, notary and Sparkle credentials, `.env` files and signing material. None found. `.env.example` never held a value. The Apple team ID is in the project and README, as in every signed build; the release workflow names its secrets but reads them from GitHub. `.gitignore` now also covers `.env*` (but not `.env.example`), `*.p12`, `*.p8`, `*.pem`, `*.key`, `*.mobileprovision` and `engine/.*.bun-build`.
- Test fixtures use made-up names: the owner's name, nicknames and Linear workspace slug became Mike Rosen, Rosie, מייק and `acme`. Same cases, same results.
- New `README.md` for visitors from GitHub: the lockup and pitch, what it does, download and requirements, the privacy promise, building from source. The full feature guide, CLI and privacy detail that were in the README moved to `docs/GUIDE.md`.
- New `SECURITY.md` (report privately to hello@didja.dev, and what counts), `CONTRIBUTING.md` (build, the rules in plain words, "a wrong tick is the bug", CHANGELOG and DECISIONS required) and `.github/ISSUE_TEMPLATE/` (bug report with no private screenshots, feature request, security link).
- Site: the GitHub organization is one setting, `ORG` in `site/src/repo.mjs` (or `PUBLIC_GITHUB_URL`). The short links `/github`, `/releases`, `/download` are now written at build time from it instead of a static `public/_redirects`.
- No change to the app or the engine.
- Not done: `LICENSE` (waits for the maintainer's choice of MIT or AGPL-3.0). `[ORG]` is still in `site/src/repo.mjs`, the README's download link and the issue template's security link. The scan used patterns; gitleaks and trufflehog ran later (above).

## 2026-11-11

### Didja updates itself (SCR-33)
- Sparkle 2.10.1: once a day the app checks https://didja.dev/appcast.xml and offers a new version in the standard window with its notes (Install Update, Remind Me Later, Skip This Version); it installs and relaunches with the same bundle ID and team, so permissions stay. **Check for Updates…** in the panel's menu; Settings › General has the daily check's switch and Check Now. Not in Debug builds or tests.
- Releasing: `scripts/release.sh` signs Sparkle's helpers for notarisation, refuses the placeholder signing key, writes `dist/Didja.dmg`, and with `APPCAST_DOWNLOAD_BASE` set signs the update and adds it to the appcast (`scripts/appcast.py`). `.github/workflows/release.yml` runs it on a `v*` tag, uploads the DMG, commits the appcast and deploys the site.
- Privacy: the update check is the second named exception to "nothing leaves the device" (CLAUDE.md, DECISIONS.md), described in Privacy…
- Tests: the feed, schedule and key are in the built app's Info.plist; no update check from tests or Debug; the appcast writer (newest first, a version published twice replaced). The Release configuration builds.
- Not done or verified: the signing key pair (generating it into the keychain needs the maintainer: `app/build/SourcePackages/artifacts/sparkle/Sparkle/bin/generate_keys`, then the public key goes in `app/Didja-Info.plist`); the workflow's secrets; an update from one real release to the next; a tampered DMG being refused. The appcast's download links need the repository to be public.

### Stays quick with thousands of tasks (SCR-32)
- Measured on a copy of a real database (a few hundred tasks, about 10,000 captured texts): the engine's work and the app's queries were quick (a 500-observation poll in 0.13 s, the task list query in 20 ms). The slow part was drawing: every row looked for its steps by scanning every task, so the work grew with the square of the list. `TaskBoard` now indexes each parent's children once per list. 3,000 tasks (1,000 checklists, 1,000 loose tasks, most done): 9.5 s before, 0.027 s after, in a test that fails above 1 s.
- The task window's list is built lazily, so the Done view with hundreds of rows builds only those on screen. Sections are grouped with a lookup instead of a search.
- Schema 017: an index on `merge_suggestions(other_id)`; the task list asked, for every task, whether a merge was suggested, by scanning every suggestion.
- Not verified by hand: how the running app feels with a few thousand tasks.

### See how a task looked where it was captured (SCR-31)
- Each open task keeps its line and up to three lines on either side from the window it was captured in, with that window's name. The row's new preview button (or V) shows them under the task as a small window, the task's own line highlighted. A checklist shows its first step's. Text only, never a picture.
- Kept only while the task is open: deleted when it is done or dismissed, with Forget Captured Text Now, and when you exclude that window. Nothing is kept when the task's words are not found in the window it came from, so the preview never shows a guessed place. Tasks captured before this change have none ("Not kept for this one").
- Privacy: this is the second exception to the 24-hour rule (CLAUDE.md, DECISIONS.md), listed in Privacy… and the Welcome window. Schema 016 (`task_context`).
- Tests: engine (lines around a task, capture markers left out, a shortened title, Hebrew, nothing kept when not found, kept while open and deleted when done) and app (V, the toggle, "not kept", forgetting, excluding, a render `preview.png`). Not verified by hand: the preview on real captured tasks in the running app.

### The app wears the Didja brand (SCR-34)
- Icons: the Dock and Finder icon is the Prompt done mark (`brand/app-icon`, every size); the menu bar icon is the same mark as a template image at 18 pt (`MenuBarIcon`), so macOS tints it for light and dark menu bars. The panel's header shows the yellow tile mark; the Welcome window and the top of the task window's sidebar show the didja lockup (light and on-dark variants in one asset); the version line in Settings › General has the mark.
- Colours (`Palette`): accent ink #141414 / highlighter #FFD93D in dark; selection #FFF6CC / #3A3216; done #1F7A4D / #3FB877; attention amber #9A4A00 / #F0A35C (never red); source labels pencil #5B5B55 / #A8A8A0; chips #F1F0EA / #2A2A27; surface paper #FAFAF7 / #161615. Primary buttons are ink with white text in light mode and highlighter with ink text in dark (`Palette.onAccent`); "Mark Done" and "Reopen" use the same style instead of the system's.
- Contrast, every text colour on its surfaces (WCAG ratio, light / dark): accent on surface 17.6 / 13.1, on selection 16.9 / 9.3, on chip 16.1 / 10.4; done 5.1 / 7.2, 4.9 / 5.1, 4.7 / 5.7; attention 6.0 / 8.7, 5.8 / 6.1, 5.5 / 6.9; source 6.5 / 7.6, 6.3 / 5.3, 6.0 / 6.0; text on a primary button 18.4 / 13.4. All at least 4.5.
- Copy: the empty list says "Nothing hanging. Nice."; the reminder is "Didja finish that? <checklist>"; the word beside the menu bar icon when Accessibility is missing is "needs you" (was "!"); Connections' "Due today or overdue" is "Due today or earlier"; the Welcome window says "the Didja mark in the menu bar". No emoji or exclamation marks in the UI.
- Checked by drawing: the list in light and dark (`popover.png`, `popover-dark.png`), the whole panel (`panel.png`, `panel-dark.png`), Welcome and Settings › General. One test changed: the surface colour test now expects the brand's paper and near-black. Not verified: the menu bar icon on a real menu bar, and the Dock icon at every size, until the app is restarted on this build.

### Add a task yourself (SCR-29)
- A or + (or the + button in the panel's header and the task window) opens a field: type the task and press Return; Esc closes it. The task is listed under "Added by you".
- It is ticked like a captured one when Didja sees it done: a command in it run at a terminal prompt, an env var or URL on the service it names, or "looks done" where it would get done. Only what is seen after you add it counts, and a task with nothing to look for (say, "Call the plumber") stays until you tick it. It is never merged with a captured task that has the same words.
- C stays "tick the whole conversation"; A alone used to do nothing. Engine: `didja add <title>`.
- Tests: the engine (stored as yours, markers, ticked by a later command, not by an earlier one, never by a vague match, not merged) and the app (A and + open the field, Return adds, empty or cancelled adds nothing). Not verified by hand: typing in the field in the running app.

### The panel closes on the first Esc and when you go to another app (SCR-30)
- Switching to another app (⌘Tab, a click in its window, the Dock) closes the panel under the icon; a click anywhere outside it does too, even when the keyboard had already left it. A pinned panel stays, as before.
- The panel asks for the keyboard again right after it opens, and an Esc that arrives before it has it still closes it. Esc in the task window or Settings is still theirs. Esc still first ends a search or lets go of chosen rows, as before.
- Tests: the rules for when Esc and outside activity close the panel. Not verified by hand: the intermittent case the maintainer saw, which could not be reproduced on demand.

### didja.dev: Brand V1 applied (SCR-28)
- The "BRAND V1" comment on SCR-28 is now the source of truth, applied to the built page rather than starting over. Logo: the Prompt done mark (a `>` prompt and a tick on the yellow tile) in the nav, the hero mock's menu bar, the favicon, a new 180px apple-touch-icon and the share image. Hero is pain first: the yellow "Didja finish that?" tag, "Ten tabs, four Claude sessions, *one forgotten step.*" (68px, 40px on phones), the vibe-coding lead and the bold promise line, then the meta line (free, open source, on your Mac, macOS 14+, Windows later). The mock's second group is Sarah's "Email Mike the contract". Tokens renamed to the brand's (paper, ink, graphite, pencil, highlighter, done, nudge); headings 52px; eyebrows upper case; reduced motion turns off transitions.
- Security: the hero mock's script moved to `/scripts/mock.js` and CSS is emitted as files, so the CSP allows no inline script or style. Short links `/github`, `/releases`, `/download` (302 to GitHub), an empty `appcast.xml`, Node 20 pinned. The version now comes from the GitHub Releases API at build time (`[VERSION]` while the repository is private); Download points at the latest release's `Didja.dmg`. The demo is a component that takes the video when it exists. On phones the nav keeps only the lockup and Download.
- Checked locally: 375px and 1440px with no horizontal scroll, focus rings, the mock's Yes / Not yet and ticks with the script as a file; Lighthouse 100 in every category on desktop and mobile. Deployed to the Cloudflare Pages project `didja` at https://didja.pages.dev: the headers are served as written (CSP, Referrer-Policy, Permissions-Policy), `/download` redirects, the mock works under the CSP with no console errors. didja.dev is live: custom domains didja.dev and www.didja.dev on the Pages project, proxied CNAMEs to `didja.pages.dev` (the zone had no records before), and a Redirect Rule sending `https://www.*` to the apex with 301, keeping path and query. Checked: didja.dev serves the page over HTTPS with the CSP; www redirects. Email: Cloudflare Email Routing is on for didja.dev (MX, SPF and DKIM records added by Cloudflare) and forwards hello@didja.dev to the maintainer's Gmail. didya.dev (bought later the same day, on Cloudflare): proxied placeholder A records (`192.0.2.1`) for `@` and `www`, and a Redirect Rule "didya.dev to didja.dev" sending every request to `https://didja.dev` + the same path, 301, query kept; checked for both names. Not done: a test email to hello@.

### Brand kit in `brand/`
- New folder with the Didja brand: the "Prompt done" mark (`>✓`) and lowercase **didja** wordmark as SVG (wordmark outlined, no font needed), PNG and PDF; light, dark and glyph-only variants; a drop-in `AppIcon.appiconset` on the macOS icon grid; a template `MenuBarIcon.imageset` (vector PDF); favicons (SVG, ICO, apple-touch-icon); a 1200×630 share image and avatars; color, font and radius tokens as CSS, JSON and `Brand.swift`. `brand/README.md` is the short guide; `brand/source/generate.py` rebuilds everything.
- Nothing in the app or site uses it yet: the app's restyle is its own issue, and the site's favicon and share image still show the old "?" until SCR-28 takes the brand update.
- Checked by looking at the rendered icons, lockups and share image. Not verified: the app icon and menu bar icon inside Xcode or on a real menu bar.

### didja.dev: the landing page, built (SCR-28; not deployed yet)
- `site/`: an Astro static site matching the Claude Design canvas "Didja Website": nav, hero with the click-to-tick menu bar mock (the "Looks done — confirm?" prompt works too), the zigzag, Catch / Watch / Tick with the app chips, the demo, the dark privacy section, the FAQ (native `<details>`), the yellow "Well… didja?" download block and the footer. Every word is in `site/src/content.ts`, verbatim from the canvas, waiting for the maintainer's update pack; tokens and fonts as the issue lists them, fonts self-hosted (no request to any other host); favicon (yellow "?"), share image `og.png` (1200×630, drawn in `site/og/og.html`), security headers for Cloudflare.
- The version on the download block comes from the app's Xcode project (0.3.0). Download and GitHub links are build-time settings (`PUBLIC_DOWNLOAD_URL`, `PUBLIC_GITHUB_URL`): the repository is private, so GitHub links keep the canvas's `[ORG]` placeholder, and the DMG (45 MB) is over Cloudflare Pages' 25 MB file limit and must be hosted elsewhere. `bun run deploy` deploys to the Pages project `didja` once the maintainer has signed in with `wrangler login`.
- Checked locally: matches the canvas at 1440px; at 375px no horizontal scroll, nav wraps, every link and button at least 44px; the mock's ticks and counters; fonts load from the site. Lighthouse 100/100/100/100 on desktop, 99/100/100/100 on mobile. Not done: deploying, didja.dev and the didya.dev redirect, the download's home, the copy fixes (Intel, the FAQ's "optional AI helper", "banking"), screenshots and demo.

### Renamed: ScrolledAway is now Didja (didja.dev)
- Everywhere: the app is Didja.app (menu bar, windows, Dock, Settings, Privacy), its bundle ID `dev.didja.app` (tests `dev.didja.appTests`, capture queue `dev.didja.capture`), the engine `Contents/Helpers/didja` (and its commands: `didja status`, `didja names`…), the Xcode project, target, scheme and folders (`app/Didja.xcodeproj`, `app/Didja`, `app/DidjaTests`), the database `~/Library/Application Support/Didja/didja.db`, the environment variables `DIDJA_DB` and `DIDJA_JUDGE`, the keychain name for connections ("Didja connection"), and the docs. Past CHANGELOG and DECISIONS entries and old schema comments keep the old name, as history.
- Nothing is lost: on first start (app or engine), the old data folder moves to the new one and `scrolledaway.db` (with its side files) becomes `didja.db`, never overwriting; the old app's preferences are copied once; Linear sign-in keys are read from the old keychain name and kept under the new one. Checked on a real database: every task at schema 15 came across, and the preferences were copied.
- Because the identity changed, macOS asks again for Accessibility, and Start at Login must be turned on again (Settings → General). Testers who have 0.2.0 or 0.3.0 will see Didja as a new app. The notary credentials keep their stored name, `scrolledaway`.
- Tests: the move (once, never overwriting) in the engine and the app. Not verified: the old login item being gone; Linear syncing after the keys move (it runs on the next sync).

### The task window is the full app: Settings in its sidebar, in the Dock while open
- The maintainer: the bigger window should feel like a full application, with every setting there and not only in the panel's "…" menu. Its sidebar now has **Tasks** (the views and sources, as before) and **Settings**: General, Connections, Your Names, How It Decides, Exclude List, Privacy; a page opens in the main area. General holds everything the "…" menu set, each with a line on what it does: reading the screen (on/off), how long captured text is kept, forget now, the OCR fallback, start at login, focus, sort, looks done, older messages, checklist reminders, appearance, how it works, keys and version. The other pages are the same views as their own windows.
- While the window is open ScrolledAway is a regular app, in the Dock and the app switcher; closing it returns it to the menu bar alone. ⌘, opens Settings in the window, and the panel's menu has **Settings…**. The list's single-key shortcuts are off while a settings page is open, so typing a name never ticks or snoozes a task.
- Checked by drawing the General page (`settings.png`). Not verified by hand: the window's sidebar and pages live, the Dock icon coming and going, ⌘,.

### Who asked is shown on the row; failed engine commands are logged and retried
- The maintainer's two other DocuSign tasks read only "Sign the document with Docusign" and "Review document with Docusign": the model named the service, not the person, and the panel showed only the wording though the sender was known. Tasks from emails and chats now show who asked under their title ("from Jordan Lee via Docusign", "from Sam Carter"), read from the chat's sender or the email's origin note (`TaskItem.asker`).
- Pressing **Merge** did nothing the first time (the same command run by hand worked: #476 merged into #475, both done). The app threw away a failed engine command's error, so the cause is not known. `EngineRunner.run` now logs a failed command (its name, and what the engine said, kept private in the log) and tries once more after half a second. Not verified: the button itself, pressed again.
- A duplicate of Sam's ask (#481) was made after the hand repair of #475: lines captured before the naming fix still carried the old chat name. Dismissed, and its merge suggestions withdrawn.

### The same thing seen in two places: suggested, merged, finished together
- Sam wrote in Teams that he would send a document to sign, then the DocuSign email from him arrived: two tasks for one thing. ScrolledAway now suggests merging a chat, email or connected-tool task with one from another place when they come from the same person (the chat's sender; the email's "From … via Docusign") and are about the same kind of action (sign, approve, pay, review, send, meet; English and Hebrew), within three days (`related.ts`). The open one shows "Same as “…” in Teams — Sam Carter?" with **Merge** and **Not the same**. Merged, the other leaves the list (a "+1" label says where else it was seen) and they finish together: ticking, reopening or dismissing one does the same to the other, and merging when one is already done finishes both. "Not the same" is never asked again.
- Schema 15: `tasks.merged_into` and `merge_suggestions`. Engine: `merge <keep> <other>`, `notsame <a> <b>`. Checked live: #475 (Teams) and #476 (DocuSign, signed) were suggested on the next poll. Tests: the pair suggested once, merging, finishing and reopening together, merging when one is done, "not the same", and pairs that must not be suggested (other action, same place).

### E-signature requests tick when you sign through the email's link
- The maintainer signed Sam's DocuSign request from its email; the task stayed open. The signing went through a link-protection wrapper, DocuSign's EmailStart and its signing app, so the address never matched the email's link; and the finished page ("A copy of this document has been saved to your Docusign account") read to the model as not done. Now (`esign.ts`), for DocuSign, Adobe Sign, Dropbox Sign, PandaDoc and SignNow: a page whose address carries the request's own id (in the link's path, or its `a=`-style value) starts the signing, and the service's finished message within 15 minutes after ticks the task, without the model. Ids naming you or an account (`er`, `acct`…), the same on every request, never count.
- Caught while applying it: matching on `er` (you, on every DocuSign email) ticked two other DocuSign requests (#451, #457) you had not signed. Fixed, tested, and both undone; only #476 is ticked. Tests: the redirects, the finished wording as seen, another document's page, the recipient's id, a message long after.

### Teams: a one-to-one chat is named after the person
- Sam's ask became its own task (#475) after the fix above, but was filed under "Teams — Chat participants": in a one-to-one chat, Teams' header heading is a "Chat participants" list, with each person marked `chat-topic-person-…`. A chat whose header lists people is now named after them; a group keeps its heading's name; the bare "participants" label is never used (`TeamsChat.chatName`). Task #475 was moved under "Teams — Sam Carter" and re-keyed so the chat's next reading does not make a second one. Checked live (masked): the chat now reads as the person's name.

### Fix: an ask merged into a finished task with the same wording
- Sam's Teams message was read and judged an ask, but the model worded it "תאשר שקיבלת", like the WhatsApp task the maintainer had just finished; tasks were matched by wording across all sources, so it was folded into that done task and never shown. A task tied to one message or item (chat, email, connected tool) now has its own identity in its key (`NewTask.distinct`) and is never merged by wording with any other task; Claude's lists keep their matching. Rewording keeps the identity. Sam's message was unlinked from that task so it is asked about again. Test: the same ask from two people is two tasks.

### Commands Claude tells you to run become tasks
- The maintainer asked Claude (chat) how to do something in the Terminal; the reply gave commands as "Check it (…):" followed by a line holding only `‹command›`, and "Open the Terminal app…, paste the command, and press Return." No list, so nothing was captured. Now (`extractCommands`): in Claude's own messages, a line that is only a shell command in backticks, handed to you by the line before ("…:", "…run:") or by a Terminal hint after it, becomes a step: "Check it (…) — run `‹command›`" (or just "Run `‹command›`" when only the hint hands it over). Steps go through the same path as lists (who it is for: the model when unclear; Not an Action). "I ran:", your own messages and commands in passing are left out. The command is the step's marker: seeing it run in a terminal ticks it. The marker list of programs gained deliberate system ones (ipconfig, defaults, killall, launchctl, networksetup, softwareupdate…).
- Checked on the maintainer's real conversation (masked): 3 steps where there were none. Tests: the steps and their wording, the cases left out, ticking by running the command.

### WhatsApp: your reactions, read from the chat list
- WhatsApp does not expose the reaction badge under a message to Accessibility (checked on a live chat: the bubble's label and hint do not mention it). The one place it shows is the chat list, whose row for that chat reads "You reacted 👍 to "‹the message›"", with no time. Capture now keeps only those rows from the chat list, as a reply from you in that chat (`— from me — reaction`), carrying the reacted-to message's first line (bold marks removed). The engine counts such a reaction only when that first line is the ask's own, and then whenever it was made; a reaction on any other message is not about the ask. With the rule above, 👍 on "תאשר שקיבלת" ticks it.
- Several reactions in one chat share that section; each line is read as its own reaction. Tests: the row read into a reply; a reaction on another message ignored, one on the ask ticking it.
- The rest of the chat list is no longer kept as screen text (it was only previews of other chats).
- The chat list's preview changes as soon as anything newer happens in that chat, so the reaction may only be seen as plain text, without the chat's name (it was, for the maintainer's 👍). A plain "You reacted 👍 to "…"" line in any WhatsApp window now answers the open WhatsApp ask whose first line it quotes (`plainReactions`). Task #453 ("תאשר שקיבלת") was ticked by hand, as the maintainer said the 👍 meant he got it.

### Chats: 👍 ticks an ask that only wants you to acknowledge it
- The maintainer: "thumbs up meant I got it", on a WhatsApp group message ending "תאשר שקיבלת" (confirm you received). An ask that only wants an acknowledgement or confirmation ("confirm you got it", "did you see…", תאשר שקיבלת, ראית) is now settled by a positive emoji reply or reaction (👍 ✅ 👌 🙏 ❤️…), without asking the model. To any other ask an emoji still only asks you (👍 to "send me the contract" means "will do"). Tests: both kinds, a 👎, and the earlier cases unchanged.
- Found while doing this: in the open WhatsApp chat, a reaction shows as a badge under the bubble that capture does not read yet; only the chat list's "You reacted 👍 to …" preview was seen. Not fixed yet: needs that chat open to map the badge.

### Release 0.3.0 (3)
- Version 0.3.0, build 3: Connections for Jira, Asana, Todoist and Notion (untried), and choosing what a connection brings in. `dist/ScrolledAway-0.3.0-3.dmg`: notarised (Accepted), stapled, Gatekeeper reports "Notarized Developer ID" for the disk image and the app. Not verified: installing it on another Mac.

### Connections: Jira, Asana, Todoist and Notion (built, not tried)
- Four more tools in Connections…, each over its official MCP server with browser sign-in: **Jira** (Atlassian's remote server; your issues, open and finished in the last 14 days, by JQL; ticking moves it by the workflow transition to the state you choose, and/or adds a label), **Asana** (your tasks in up to three workspaces; ticking completes it; sections named like "In progress" count as in progress), **Todoist** (your open tasks and those finished lately; ticking completes it, with an optional label), **Notion** (tasks in the databases you tick, by their Status, Due and Assignee-like properties; ticking sets Status). Projects (or databases) take the place of Linear's teams under "From".
- The maintainer chose to build them without accounts to try. So each adapter (`adapters.ts`) picks its tools at run time from the server's own list, by a few likely names, passes only the arguments a tool declares, and when a tool is missing says which one in the Connections window instead of guessing; nothing is changed in the tool then. Each tool card says it has not been tried. A server that only speaks the older SSE transport is tried after the newer one, and the one that answered is remembered (sign-in finishes on it).
- Linear moved onto the same adapter shape; checked live after the change (sync ran cleanly). Tests: 6 with stand-in servers (finding tools, Jira transition and label, Todoist and Asana completing, a missing tool reported, Notion properties). Not verified: any of the four against the real service, including whether their servers accept ScrolledAway's sign-in (dynamic client registration).

### Release 0.2.0 (2)
- Version 0.2.0, build 2 (was 0.1.0, 1): chats, emoji replies, Your Names, Connections, Go to Source, the stricter "looks done", and the fixes since the first release. `dist/ScrolledAway-0.2.0-2.dmg`: notarised (Accepted), stapled, Gatekeeper reports "Notarized Developer ID" for the disk image and the app; the signed engine runs, including the connections code. Not verified: installing it on another Mac.

### Connections: choose what comes in, and from which teams
- The maintainer: what comes in should be set up per connection, not hard-coded. The Connections window has a **Bring in** section: issues assigned to you that are due today or overdue (on by default), in progress, to do, or in the backlog, any mix; and from all teams (default) or only the teams you tick. Done and cancelled issues never come in. Engine: `connection <id> bring due|started|unstarted|backlog on|off`, `team <name> on|off`, `team all`; kept in the connection as `bring`.
- Checked on the maintainer's Linear: all 52 assigned issues carry their team (one of 3); today the rules would bring in 0 in progress, 0 to do and 1 backlog issue. Tests: what each rule and team filter lets in; the window's choices run the engine; the window drawn.

### Connections: Linear connected; its states listed per team
- The maintainer's second sign-in worked: connected, keys in the keychain, and a sync read the assigned issues. None has a due date, so nothing is due today or overdue and nothing came in, as chosen.
- The "Move it to" menu was empty: Linear lists statuses per team. ScrolledAway now lists your teams, then each one's statuses (7 found, including Done); labels were already read (3).

### Connections: sign-in comes back to ScrolledAway and says so
- The maintainer's first sign-in ended on Linear's homepage and never came back, so no keys were kept. The return address is now `http://localhost:33418/callback`, listened for on both of this Mac's loopback addresses (IPv4 and IPv6), and a registration made for the old address is redone. A one-time `state` value must come back with the code, so only a sign-in ScrolledAway started completes. The page you land on says "Connected to Linear. You can close this tab" and closes itself; a failed one says so and asks you to press Connect again.
- Not verified: why Linear went to its homepage (likely: not yet signed in to linear.app in that browser, so its login page took over); the second attempt.

### Connections: Linear over MCP (the one network exception)
- **Connections…** in the panel's menu. Connect Linear: your browser opens Linear's own sign-in (OAuth, through Linear's MCP server at `mcp.linear.app`); the keys are kept in your login keychain. Issues assigned to you that are due today or overdue come in as tasks under "Linear", each with a label holding its key (click it to open the issue). Done or cancelled in Linear, or no longer yours, closes it here. Ticked here, it is written back once: moved to the state and/or given the label you choose in the window (Move it to: Done by default); also when ScrolledAway ticks it on its own and is very sure, if that box is on (it is by default). Synced every five minutes, and right after you tick one.
- This is the first and only network use, by the maintainer's choice: only to the tools connected, reading your items and sending the change for ticked ones; never screen text, observations, notes or other tasks. CLAUDE.md's hard rules, DECISIONS and the Privacy page say so; the Privacy page lists what is connected. New dependency: `@modelcontextprotocol/sdk` (the MCP client; it phones nowhere itself).
- Engine: `connections`, `connect linear`, `connection <id> state|label|whensure|choices`, `disconnect <id>` (also deletes the keys), `sync`. Tests: 7 engine tests with a stand-in for Linear (what comes in, closing, writing back once, the "very sure" switch, a signed-out connection), 2 app tests and a drawing of the window. Not verified: signing in to the real Linear and a real sync; reading the states and labels for the pickers; how Linear's MCP server answers `list_issues` exactly (the reader accepts the shapes it is likely to take).

### Every task looks done only where it gets done
- The maintainer chose to apply the email rule to all tasks: a task from Claude, too, is shown to the model only from a screen on the site or app it names (or a site its email linked to). A task that names none is no longer checked by "looks done" at all; it is ticked by its exact markers, by you, or not. Fewer suggestions, no more from pages that only share a task's words. Tested: a Supabase step is not asked about from a Linear issue with the same words, and is from Supabase.

### Email tasks look done only where they get done
- "Sign the document with Docusign" (from an email) was marked looks done from the maintainer's Linear page, which only shared its words. An email task is now shown to the model only from a screen that is where it gets done: a site or app the task names (docusign.com, the DocuSign app) or the site of a link the email gave (`isWhereItIsDone`). Other tasks are checked as before; chat tasks not at all. The wrong suggestion was cleared (Not yet).

### Outlook: a reaction on an email you were asked to answer asks you
- Outlook for Mac shows the open email's reactions beside Reply as a button described "1 Like … reactions". Capture writes it as a `Reactions: 1 Like` line in the email's section; the engine keeps it out of the body (so the email is not read again as a different one). When the email holds a request still waiting for your answer, a reaction on it suggests the task is done ("a reaction (1 Like) on …"), never ticks it: Outlook says how many and which, not whose, and 👍 can mean "will do". "Not yet" stops that reaction asking again.
- Found on the maintainer's live Outlook (masked outline: the `ReactionsControl` "React" button and the summary next to it). The outline tool now lets reaction words through its mask. Not verified: the whole flow on a live email (the email changed before it could be checked); reactions in Gmail and Outlook on the web.

### Chats: emoji replies and reactions; no thanks as asks; never "looks done" from another screen
- Your emoji reactions are read: WhatsApp's "You reacted ❤️ to "…"" and Teams' reaction pill you added (marked checked, "1 Heart reaction."). Each becomes a short reply from you right after the message, `[reacted ❤️ to “…”]`, weighed like any reply. A reply of only emoji, or a reaction, never ticks a task on its own: if the model reads it as settling, you are asked (looks done?), because 👍 to "can you send it?" means "will do" (the model got exactly that one wrong). A reaction is not taken as having answered an ask before the model has seen it.
- A Teams task, "Lena Hale ask Mike Rosen to respond to birthday message", came from a thank-you for the reader's birthday wish. The model is now told that thanks, congratulations, birthday wishes and replies to something the reader said are never asks, even when they name the reader; and a task worded around you (it names you) is dropped, since the model misread who asks whom. That task was marked Not an Action.
- The same task was marked "looks done" from the maintainer's Planner page in Edge, which shared some of its words. Chat tasks are no longer checked against other screens at all: an ask in a chat is settled by your reply in that chat.
- Not done: reactions in Outlook and other mail (not yet seen on screen to read them); Slack reactions. Not verified live: reading reactions (tests and the masked outline only).

### Your Names: your name and nicknames, in any language
- **Your Names…** in the panel's menu: your name (your Mac account's by default; change it if people know you by another, clear it to go back), other names and nicknames in any language and spelling (add, remove), and the names learned from your mail, shown read-only. Group chat messages count when they tag or name you by any of these, and your own messages are known by them. Kept by the engine: `scrolledaway names [--json] | set [<name>] | add <name> | remove <name>`; the chosen name in `meta.my_chosen_name`, the others in `meta.my_other_names`. The maintainer's Hebrew name, אסף, was added.
- Not verified by hand in the live window; tests cover the model's engine commands and draw the window (`names.png`).

### Older Messages: Ignore Them (New Messages Only) (SCR-27)
- New choice in the panel's menu, **Older Messages: Capture Tasks From Them / Ignore Them (New Messages Only)**. The first is the default and nothing changes. With the second, tasks come only from messages that arrive after you first looked at a conversation: in Claude, messages numbered at or below the newest one shown when you first opened it (within the kept observations) are skipped, which also covers what scrolling back brings up; in chats, messages sent before the chat was first on screen are skipped. Claude Code in a terminal, email, ticking and existing tasks are unchanged.
- Not verified: on the live app; that Claude's message numbers are the message's place in the whole conversation (the tests assume so, from captured `⟦Message 40⟧`-style sections); and a brand-new conversation renamed by Claude after its first answer had already finished, which would then be read as a new window and its first answer skipped.

### Chats: in a group, only what tags you or asks everyone for their own answer
- The maintainer: in group chats (any chat app), only a message that tags or names you, or one that asks every member for their own answer ("everyone please confirm", "כולם תאשרו הגעה", @all), should become a task; never a request meant for someone else, nor "can someone…", which anyone can answer for all. The engine's pre-check now also lets through messages asking everyone (`asksEveryone`), and the model is told how the message reaches you ("tags or names you" / "may be addressed to every member") and to answer false for "can someone…" or requests to others. Checked on five group messages: all right.
- `scrolledaway names add <name>` adds a name you are tagged or called by (WhatsApp tags you by the name others saved you under, often in Hebrew); `names` lists them. Kept in `meta.my_other_names`.

### Fix: WhatsApp groups taken for one-to-one chats; a done reply judged as putting it off
- In a group, WhatsApp labels a message "Message from Ron, …, 10:54, Received in Family", not "message, …, Received from …". The sender was missed and the group was taken for a one-to-one chat, so two group messages that did not name the maintainer became tasks. Both forms are read now, and "Received in" marks a group. The two tasks were dismissed.
- The maintainer's one-word reply "הזמנתי" ("I ordered it") was judged by the model as putting the ask off. The reply question now says that a reply saying it has already been done (often one past-tense word: ordered, sent, paid; הזמנתי, שלחתי, שילמתי…) settles it, and one about doing it later defers it. Checked on five replies (Hebrew and English): all right. The stored verdict for that reply was cleared so it is judged again.

### Fix: WhatsApp messages sent today were not read
- WhatsApp labels today's messages with the time alone ("…, 10:54, Received from Dana"), not "Today at 10:54", and the reader expected a date, so a request that had just arrived was not seen. The date is now optional; the time must still be the label's own (followed by "Received from…", "Sent to…" or the end), so a time inside the message is not taken. Found by the maintainer on the live app; tests cover both shapes.

### Chats: WhatsApp and Teams messages that ask something of you become tasks (Slack built, untested)
- Capture labels each message of the open WhatsApp, Teams or Slack conversation with its chat, whether it is a group, who sent it and when (`ChatAdapter.swift`). The engine puts a recent message from someone else to the on-device model: in a one-to-one chat any ask, in a group only one that @mentions or names you. It becomes a task worded by the model ("Send Dana Levi the signed contract"; Hebrew in Hebrew), filed under the chat.
- Your reply after the ask ticks it, labelled, unless the reply puts it off: plainly ("tomorrow", "I'll check", "אחזור") never ticks; otherwise the model judges settles, defers or unsure, and unsure (or no model) only asks you. Only a reply sent after the ask by its shown time counts, so scrolling up to an older message of yours never ticks anything. Reopening such a task stops replies there ticking it again.
- The app writes your Mac account's full name to `meta.my_name` so your own messages, and messages naming you, are recognised. `ScrolledAway --ax-outline <bundle id>` (and `--lines --ax-outline`) shows a window's Accessibility shape or capture lines with all but UI words masked, for building adapters.
- Verified: WhatsApp and Teams labelling on the live apps, read only and masked (4 WhatsApp messages in a direct chat; 16 Teams messages in a group with one @mention flagged); the model's answers on made-up messages (asks, thanks, a group @mention, Hebrew, three replies). Tests: 14 engine tests for chats, including every way a non-reply must not tick; 6 app tests for the parsers. Not verified: tasks made from real chats over a day of use; Slack at all (not installed).

### OCR fallback reads only the window you are in (SCR-18)
- Reading the OCR code found one fault. When no on-screen window had the focused window's title, it grabbed the app's largest window instead, and that window's title had not been checked against the exclude list. With a private browser window behind the one you were in, that window could have been read. Now OCR reads only the window with the focused title, or the app's only window. Otherwise it reads nothing, and the chosen window's own title must pass the exclude list.
- OCR had been reading a few windows (a screenshot tool, a chat app and a page in a browser) before this fix. Not verified: that the OCR text matches what those windows showed, and that no frame reaches disk. Only the code was read for that: the image is never written.

### Email: a finished old-style "Reply to…" task is not made again (SCR-14)
- A review of real email tasks (read only) found one fault: "Reply to <payment service>: Update your card information" was ticked, and when that email was asked about again it came back as a second task, "Update card details". Tasks made before emails were linked were matched only while still open. Now a finished or dismissed one is matched too, linked to the email, and left as it is.
- Also seen, not faults in today's code: two other old tasks still show Outlook's "Available" in the sender's name, and one forwarded email made two tasks; all three were made before those fixes shipped and are finished, so they are not reworded.
- Not verified: who each task names and whether each title fits; that needs the maintainer's review of a day of real mail.

### Choose several tasks at once: ⌘A, ⇧↑↓, ⌘-click, ⇧-click (SCR-26)
- In the panel and the task window, ⌘A chooses every row on show (under a search, only the matches). ⇧↑ and ⇧↓ grow or shrink a run of rows from where you started; ⇧-click chooses from the last row clicked; ⌘-click adds or removes one row. Chosen rows share the highlight colour; only the highlighted one shows its buttons.
- Space ticks every open chosen row (a checklist's steps go with it), and reopens only when none of the chosen rows is open, so a mixed choice never undoes finished work. D or Delete dismisses and S snoozes the open ones. The right-click menu on a chosen row has the same three. ⌘C copies them all. Esc lets go of the choice before it closes anything; a plain arrow or click goes back to one row.
- Engine changes made from the app now run one after another instead of side by side, so many at once do not race into the database.
- Not verified live: only tests (10 new). The issue asked for ⌃+arrows; ⌃↑ and ⌃↓ belong to Mission Control on a Mac, so it is ⇧ (see DECISIONS).

### Go to Source: a running conversation's sidebar entry counts as its name
- It still did not switch: while a conversation is working, Claude's sidebar shows "Running" after its name, so the entry was no longer exactly the name and was not pressed. The name may now be followed by at most three status words (running, working, waiting, unread, new, a time such as "2m" or "5h ago"). Any other word after the name (Delete, Archive, Rename…) still means it is not pressed; tests cover both.
- Verified read-only (`--look-only`) on both running conversations: it picks their sidebar entries. Not verified live: the maintainer trying it.

### Go to Source opens Claude conversations again: the one button it may press
- With no button presses at all, Go to Source brought Claude forward but did not open the conversation: Claude's sidebar shows each conversation as a button. The maintainer allowed that one kind: a plain button whose whole text is exactly the conversation's name, in the left third of the window. No other button is pressed. `--look-only` (with `--go-to-source`) reports what it would press, reading only.
- Verified read-only: for a Acme_Dashboard task it picks that conversation's sidebar button. Not verified live: the open and the scroll after it.

### Go to Source keeps its hands off: stops when you touch anything, never presses a button
- A live test scrolled the maintainer's Claude conversation for about a minute (53 pages), moved the pointer back each time, and kept going while they tried to switch away; they stopped it from their phone. Now everything Go to Source scrolls is checked first: it stops after 5 seconds of scrolling (10 in all), or at once when you move the pointer, press a key (Esc included), click, scroll, or bring another app forward. The pointer is never moved.
- It never presses a button. Opening a conversation from the sidebar follows a link or selects a row or cell, and stops at a button rather than press it.
- New: when the line is above what a conversation has loaded (Claude keeps only the latest stretch), it pages up: the top message outside the sidebar's column is brought into view and the scroll wheel turned over the conversation.
- Verified live, before the safeguards: the sidebar opened the right conversation each time, and a line 53 pages up was found and scrolled to. Not verified live with the safeguards: no run since; tests cover the stop rules, the sidebar rule and where the wheel turns. Without moving the pointer, an app that scrolls only what is under the pointer may not page at all; it then stops at 5 seconds with the conversation open.

### Test fix: pinned panel height
- The pinned-panel test set a window 80% of the screen tall, a fractional height on some screens (848.8), and windows snap to whole points. It now asks for a whole number. No app change.

### Go to Source: find the window by what is in it, and scroll after reopening a page
- It did not scroll anywhere: it looked for the window by its title, and the titles rarely match. Claude's window is titled "Claude" while capture names it after the conversation, and a browser window's title follows whichever tab is in front. It then gave up and reopened the address. Now it searches each of the app's windows for the line (the one with the matching title first), raises the one that has it and scrolls there. If no window has the line, a browser reopens the page, waits up to 6 seconds for it to load, and then scrolls.
- In Claude (and other apps with a sidebar of conversations), when the line is not in the open conversation, the conversation is opened from the sidebar by its name, then scrolled to. Not verified live: in the run tried, the conversation was already open, so the sidebar step did not happen.
- Outlook for Mac (and other apps with long native lists): if no window shows the email, it pages down each message list, up to 30 times, until the subject turns up. Then it selects the row, which opens the email, and scrolls to it. A list that does not have it is scrolled back to the top. Not verified live: on the task tried, the email was not among the 51 rows the Inbox list holds and the list did not load more, so only the window was raised.
- `ScrolledAway --go-to-source <place.json>` runs it from a terminal and prints each step (counts and sizes only, never screen text).
- Verified live in Edge on an Outlook on the web task: the email was reopened and scrolled to after about a second. A Claude task was found and scrolled to in its open conversation. Not tried: terminals, Outlook for Mac.

### Go to Source
- Right-click a task and choose **Go to Source**, press **G** on a highlighted row, or use the button in the task window. It brings the app forward, raises the window the task was captured in, reads that window again to find the line (by the task's words, or an email's subject) and scrolls it into view. If the window has gone it reopens the page's address in the browser it came from, or else just brings the app forward. Nothing read while looking is kept, and the exclude list and password fields are handled the same way as during capture.
- Schema 14 keeps the app, window title and page address on each task, so this still works after the observation it came from has expired. Tasks captured earlier get theirs from their first sighting, while that sighting is still kept.
- Not verified in the live app: no jump was tried on screen. Tests cover the matching, the window lookup and the engine's `place` command. Scrolling depends on the app honouring `AXScrollToVisible`; terminals and chats that load lazily may only raise the window.

### Release script: Developer ID, notarised, in a disk image (SCR-19)
- `scripts/release.sh` builds Release into `app/build-release`, re-signs the bundled engine and then the app with Developer ID and the hardened runtime, makes `dist/ScrolledAway-<version>-<build>.dmg`, has Apple notarise it (credentials in the keychain profile `scrolledaway`), staples the ticket and checks Gatekeeper accepts it. `--local` signs with any identity and skips notarising. The Xcode project's signing settings are unchanged. First run 2026-11-11: `ScrolledAway-0.1.0-1.dmg` notarised (Accepted), stapled, and `spctl` reports "Notarized Developer ID" for the disk image and the app; the signed app and engine start from the mounted image. Not verified: installing and running it on another Mac.

### Fix: the app crashed reading a very deep window
- Reading a window's Accessibility tree recurses once per level, up to 100 levels. On the capture queue's thread (512 KB of stack) a deep page overflowed the stack and the app quit (crash report 2026-11-10 23:58, inside `AXCapture.Walk.node`). The walk now runs on its own thread with a 16 MB stack. A test checks the walk gets the large stack even when called from a dispatch queue. Not verified: the page that caused it is not known, so the crash itself was not reproduced.

## 2026-11-10

### Pin the panel where you want it (SCR-25)
- "Pin Panel (Move and Resize It)" in the panel's "…" menu, or by right-clicking the menu bar icon, turns the panel into a small window you can drag anywhere and make taller or shorter. The icon, ⌃⌥S and Esc show and hide it there; it stays above other windows while shown and opens in the same place after a restart. "Unpin Panel (Back Under the Icon)" returns it to the menu bar. Not verified by hand in the live app: dragging, resizing and the right-click menu were not tried on screen; tests pin, move, hide, show and unpin a real panel.

### Pressing F puts the keyboard in the search (SCR-22 review)
- After F (or a click on the search bar) the letters you type now go into the search. The search box is now an AppKit text field that takes the keyboard itself, and takes it back if its window becomes key again. A key pressed while the search is on but the field somehow lacks the keyboard is handed to the field, so it is typed into the search and never taken as a shortcut. Not verified in the live panel: the failure could not be reproduced in tests (SwiftUI's focus worked there too), so the fix is not proven against the case that failed for you.

### Teach the model (SCR-24)
- **Not an Action (Teach It)** on any task (right-click in the panel or task window, or in the task window's detail pane): dismisses it, never captures the same wording again (for email, that conversation), and the on-device model is shown the case from then on.
- **Not Done (Teach It)** on an auto-accepted task: reopens it and teaches the "looks done" question.
- **How It Decides…** in the panel's menu: the plain-English instructions the model reads for each of its four jobs, yours to edit, copy into another AI and paste back, or reset; the corrections you made, each removable; a **?** explaining it all. Schema step 013. Not verified in the live app, and the effect of corrections on the model's answers has not been measured.

### Accept "looks done" automatically (SCR-23)
- New choice in the panel's menu, **Looks Done: Ask Me / Accept Automatically**. Ask Me is the default and nothing changes. With Accept Automatically, a task the on-device model says looks done is ticked for you (suggestions already waiting too), labelled "auto-accepted" in its row, and `why` says where it looked done. Reopening one records that place as wrong, so it is never ticked from there again. Schema step 012 adds `accepted_from`. Not verified in the live app.

### "Click here" links in emails are kept on their task (SCR-13)
- A link in an email whose words are not its address ("Approve", "click here") is now captured with its target, so following it can tick the task like a visible address. Only inside an open email's body; links elsewhere are still read as words only. Not verified: no real email with such a link has been read yet, and no follow-the-link tick has been seen on real mail.

### Archiving several emails in a row is caught more often (SCR-8)
- When you archive again while Outlook's "Archived" notice is still up, Outlook replaces the notice with a short gap. The app now looks at the window seven more times in the 2.8 seconds after an email leaves or the notice goes, to catch that gap. When no look lands in it, nothing is dismissed. Archiving from the message list, with no email open, is still not detected (written down why in ARCHITECTURE). Not verified live.

### Requests from no-reply and service addresses become tasks (SCR-12)
- Mail from addresses like `no-reply@`, `billing@` or `support@` used to be skipped outright. It now reaches the on-device model when it says something needs doing on your side ("update your card", "action required", "your domain expires", "payment failed"). Receipts, sign-in notices, newsletters, marketing (anything with an unsubscribe line), calendar replies and auto-replies are still skipped. Not verified on real mail.

### Claude Code and claude.ai are listed as Claude (SCR-17)
- Checklists from Claude Code in a terminal or editor are listed as "Claude Code — <conversation> (Ghostty)", and from claude.ai in a browser as "Claude — <conversation>", instead of under the terminal's or browser's name. Focus offers "Only Claude Code" and "Only Claude" for them. Existing sources are renamed once when the engine starts. Not verified: seen in the live panel.

### Forget Captured Text Now asks first (SCR-15)
- The menu item is now "Forget Captured Text Now…" and asks "Delete all captured text?", saying how much will go and that tasks stay. Delete is never the default: Return and Escape cancel. Not verified: clicked in the live app.

### Welcome window can no longer crash like the Exclude List did (SCR-16)
- It is a fixed-width window whose content scrolls, instead of sizing itself to its content. A test flips the permissions while it is on screen. Not verified: opened in the live app.

### Hebrew emails: a Hebrew task that says what was asked, and the whole signature (SCR-11)
- An email written mostly in Hebrew gets its task in Hebrew, naming what it actually asks for ("שלח למיכל את החוזה החדש ואת אישור הביטוח" for a forwarded contract email that used to become "Collect bank details for payment"). English emails get exactly the prompt they had.
- Who asked is shown with the whole signature line, also when the model joins the header's full name to a cut-off role ("נועה כץ - מש" becomes "נועה - מש"א").
- A Hebrew closing such as "אם יש שאלות אני כאן" no longer makes a thank-you email a task.
- `engine/eval/` holds 14 made-up emails (7 English, 7 Hebrew) and a runner for prompt work. Before: English 4/7, Hebrew 2/7 (one Hebrew task named PayPal, copied from the prompt's examples). After: English the same 4/7 with the same wording, Hebrew 7/7.
- Not verified: real Hebrew mail on screen. The three English misses (PayPal and DocuSign answered as reply rather than action; "let me know if you have questions" taken as a request) are unchanged and not addressed here; for a service address the engine already turns reply into action.

### Outlook: your own messages are not tasks (SCR-10)
- In Outlook for Mac and Outlook on the web, a message you sent no longer becomes a task, even when it reads like a request. The engine learns your account from the window title (`Inbox • you@example.com` in Outlook for Mac, `Mail - Your Name - Outlook` on the web) and the name your messages are sent as, and keeps them in `meta.mail_identity`. Your reply is still noticed for "looks done — confirm?".
- The Privacy window lists this as "Your mail account".
- Verified: engine tests for both Outlooks. Not verified: the real window titles on this Mac; if a title is shaped differently, nothing is learned and behaviour is as before.

### Privacy window
- **Privacy…** in the panel's menu, and **Privacy in Detail…** on the welcome screen, open a window that says what is read, what is never read, what is kept and where, what the on-device model is shown, and that nothing leaves the Mac. Live facts: how long text is kept, how much is stored, the exclude list, whether Screen Recording is granted, whether the on-device model is available, whether capture is paused.
- Fixed width with scrolling content, like the Exclude List window, so it cannot fall into the resize loop that crashed that window.
- Not verified: opened in the live app.

### Development log
- This file and [DECISIONS.md](DECISIONS.md). [CLAUDE.md](../CLAUDE.md) now requires both to be updated with every change.

### Panel search (SCR-22)
- Search in the menu bar panel narrows the list as you type. A search bar under the header; click it or press F, / or ⌘F. It matches a checklist's or task's title or any of its steps, folded away or not; a dismissed step no longer counts outside the dismissed view. The five recently finished below the list are narrowed too.
- ↓, ↑ or Return move from the search to the list; Esc clears it; the search is forgotten when the panel closes. Letters typed into the search never act on a task.
- While a search hides rows, ticking a whole conversation (C and the circle on its heading) is off in the panel and the task window.
- Verified: Swift tests (85, 0 failed) and the rendered `popover-search.png`. Not verified: typed into the live panel.

### Fixes
- The Exclude List window crashed the app: it sized itself to its content and looped with AppKit. Now a fixed-width window whose content scrolls. A test reproduces the crash against the old setup.
- A click on the menu bar icon while the panel is open closes it, instead of closing and reopening it. Not verified by clicking the real icon.

### Archiving an email takes its task off the list
- Outlook for Mac: when Outlook's "Archived" notice appears and the open email left the reading pane just before, that email's task is dismissed (not ticked). Built from a masked recording of real archives. **Verified on the live app** (SCR-6).
- Gmail uses the same rule with "Conversation archived"; not verified. Outlook on the web is not covered (SCR-7). Archiving several in a row or from the message list is not caught (SCR-8). An email archived on another device is not noticed.

### Focus and Sort
- **Focus** in the panel's menu narrows every list to one app's tasks ("Only Claude", "Only Gmail"); the open count shows the app.
- **Sort**: by source (as before) or latest activity first, where a checklist is as recent as its newest step.
- Claude Code in a terminal appears under the terminal's name (SCR-17). Not verified in the live app.

### Following an email's link
- The links in an email (unwrapped from Proofpoint and Safe Links, only ones that name a page or record) are kept on its task. On that page, after you have been there at least 10 seconds, a "done" from the on-device model ticks the task; on arrival it only asks. The first place the model's judgement can tick.
- Not verified on real mail (SCR-13). "Click here" links whose address is not visible are not captured.

### Outlook on the web
- An open email at outlook.cloud.microsoft (and office.com, office365.com, live.com) is captured as its own section and handled like Outlook for Mac. **Verified on the live page.**

### Email tasks say what to do, and who is asking
- The on-device model writes the task ("Update card details on PayPal") instead of "Reply to <sender>: <subject>", and says whether it is done by writing back or somewhere else. Only replies wait for your answer in the thread.
- Forwarded emails name the person who wrote the request (from the signature), not the forwarder; a signature the model cut short is completed from the message.
- One task per email: re-reading an email rewords its task and never makes a second or brings back one you finished.
- Outlook's presence word ("Available") is dropped from names; service addresses are never waited on for a reply.
- Gmail in a browser: each message of a thread is its own section; your own messages are not tasks.
- Verified partly: a real forward was attributed correctly; the rest is tests and made-up emails (SCR-14).

### Exclude List window and retention
- **Exclude List…**: add an open app, a window title by the words it contains, or a site by name. A change applies at once and deletes what was already kept from anything added.
- **Keep Captured Text For** 1, 6 or 24 hours (never more), and **Forget Captured Text Now** (asks nothing yet, SCR-15).

### Earlier the same day
- Reminders for unfinished checklists; an app icon.
- Pause hot key (⌃⌥P), a key for Not yet, search, Collapse All and finished work by day in the task window.
- Email: Outlook for Mac messages that need a reply become tasks; your reply in the thread asks you to confirm.
- Finished items stay in place for 3 seconds with their steps ticked, then move to a folded "Recently done".
- "Looks done — confirm?": for tasks with nothing exact to match, the on-device model suggests when a later screen shows them done. Never ticks.
- Welcome screen: what is read, what never is, permissions.
- Short checklist titles written by the on-device model.
- Lists Claude was going to do itself are taken back; only what is asked of you is kept. The on-device model decides when the wording does not.
- Nested steps to any depth, rename, fold; a new task window; white surface; Light / Dark / Follow System.
- Copy a row or a whole checklist (SCR-5), how long ago each item was captured (SCR-4), tick a whole conversation (SCR-3), row buttons that do not move the text (SCR-2), global hot key and keyboard control (SCR-1) — built by the agent from Linear.
- Popover with tick, snooze, dismiss and why; launch at login; drafts you are typing are not read.
- Checklists grouped under a parent task, ticks cascading both ways.
- Signed with the Apple Development certificate so the Accessibility permission survives rebuilds.
- Milestone 2: exact markers (commands, env vars, URLs) seen in the right place tick a task, with evidence.
- Milestone 1: native capture (Accessibility, OCR fallback, differ, privacy rules, 24-hour expiry), shared SQLite schema, Bun engine extracting Claude checklists, Xcode project bundling the engine.
- Before that, the first version used Screenpipe; it was removed when the brief changed to native capture only.
