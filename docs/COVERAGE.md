# Capture coverage

Where AI tools show you steps, and whether Didja has been checked against each place. Didja can only
make a task from what capture keeps, and each tool puts steps in more than one place: its replies,
and panes beside them (docs, canvases, artifacts, plans). A place that has not been checked can fail
silently, as the Claude app's doc pane did: its checklist was read as plain text with every box gone.

## How a place is checked

A **surface fixture** (`profiles/fixtures/surfaces/<tool>-<place>.json`) is the place's window as an
outline (roles, classes, values) with made-up text, the lines capture must keep from it, and the
tasks the engine must make (`expect.tasks`), and must not (`expect.notTasks`). Two tests run every
fixture: `SurfaceFixtureTests` (outline to lines, the app) and `engine/test/surfaces.test.ts` (lines to
tasks; the stand-in model says every list is yours, so a list wrongly read shows up).

To add one:

1. Open the place with made-up content in it (a checklist, a numbered list, a table of steps). Never
   real content: the repository is public.
2. Record its shape, masked, without bringing anything forward:
   `Didja.app/Contents/MacOS/Didja --ax-outline <bundle id> outline.txt`.
3. Write the fixture's outline from that shape with your made-up words, run the app's tests, and put
   the lines it prints (`SURFACE <file>: …`) in `lines` once they are right. Then the engine's test.
4. If capture or the engine gets it wrong, that is the bug to fix; the fixture is its test.
5. Add the place to the table below.

## The table

"Shape" says where a fixture's outline came from: **recorded** (a real window's structure, masked,
with made-up words), **made up** (built from a recorded neighbour, not yet seen live), or none.
Replies are checked by the line fixtures in `profiles/fixtures/assistants/`, which start from the
lines capture keeps, not from an outline.

| Tool | Place | Shape | Fixture | Status |
| --- | --- | --- | --- | --- |
| Claude app | Replies | lines | `assistants/claude-desktop-*.json` | Works |
| Claude app | Doc beside the chat: checklist | recorded | `surfaces/claude-desktop-doc-pane.json` | Works (fixed 2026-11-14) |
| Claude app | Doc beside the chat: numbered list | made up | `surfaces/claude-desktop-doc-pane-numbered.json` | Works on the made-up shape |
| Claude app | Artifact pane (HTML, code, diagrams) | none | | Not checked |
| Claude app | Code tab: plan and todo cards | none | | Not checked |
| claude.ai in a browser | Replies | lines | `assistants/claude-web-*.json` | Works |
| claude.ai in a browser | Artifacts and docs | none | | Not checked |
| ChatGPT (app and web) | Replies | lines | `assistants/chatgpt-*.json` | Works |
| ChatGPT | Canvas | none | | Not checked: a rich editor, likely the same shape as the doc pane |
| Gemini (web) | Replies | lines | `assistants/gemini-*.json` | Works |
| Gemini | Canvas | none | | Not checked |
| Copilot (app and web) | Replies | lines | `assistants/copilot-*.json` | Works |
| Copilot | Pages (Loop) | none | | Not checked |
| Copilot in VS Code, Cursor, Windsurf | Chat panel | lines | `assistants/vscode-*`, `cursor-*`, `windsurf-*` | Works |
| Cursor, Windsurf | Plan and todo panes | none | | Not checked |
| Claude Code, Codex, Gemini CLI, Copilot CLI, Aider, Goose, OpenCode | Terminal | lines | `assistants/<tool>-*.json` | Works |
| Devin | Replies | lines | `assistants/devin-*.json` | Works |

A place that is "Not checked" may well work. It means nobody has seen what capture keeps from it.
