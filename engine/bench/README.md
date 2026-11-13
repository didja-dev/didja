# End-to-end benchmark (SCR-64)

Made-up sessions replayed through the engine with a fake clock, measured against labels written by hand: what should become a task, what must not, and when each task was really done (or that it never was).

```bash
cd engine
bun bench/run.ts                      # no model: deterministic, what CI runs
bun bench/run.ts --model apple        # Apple's on-device model, through the built app (DIDJA_JUDGE or the Debug build)
bun bench/run.ts --model ollama:qwen3.8:latest   # that local model asked first, as the app does
bun bench/run.ts --only outlook-reply --verbose  # one scenario, with the tasks it made
```

It prints one row per scenario and the totals:

- **Capture:** recall (labelled tasks found), precision (tasks made that were labelled), and tasks made that must not exist. Counted on what is on the list at the end: a task the engine took back (an agent ran it, a list judged the assistant's own) has left the list, so it is neither found nor unwanted; `--verbose` lists it as "taken back" (SCR-85). A task ticked and later taken back still counts as a wrong tick.
- **Done:** of the tasks really done, how many were ticked, asked about ("looks done?") or missed; **wrong ticks** (ticked before it was done, or never done, or a task that must not exist ticked) and **wrong asks**; the median minutes from done to ticked or asked.

- **Speed** (SCR-75): each new task, tick and "looks done?" timed from the observation that showed it, as `didja quality` does, on a fake clock: the runner polls every 5 s like the engine, and each model call costs its measured median (`MODEL_COST_MS`: Apple 1 s, Ollama 2.5 s). Median and 90th percentile per kind.

- **By tool** (SCR-82): the same counts per tool family, after the totals.

It exits 1 on any wrong tick, and on a new task or sure tick with no model that takes over 3 s. `bun test` runs it with no model too (`test/bench.test.ts`).

## A scenario

`scenarios/NN-<id>.json`, made-up content only: people and chats from `profiles/fixtures/names.txt`, addresses at `example.com` or `acme.com` (checked by `test/bench.test.ts`).

```json
{
  "id": "terminal-failed-then-rerun",
  "about": "A push is rejected, then run again after a pull and accepted.",
  "family": "claude-app",
  "start": "2026-11-11T09:00",
  "steps": [
    { "at": 0, "app": "Claude", "bundle": "com.anthropic.claudefordesktop", "title": "Release", "text": ["⟦Message 4⟧", "Claude responded: …", "`git push origin main`"] },
    { "at": 3, "app": "Terminal", "bundle": "com.apple.Terminal", "title": "zsh", "text": ["… % git push origin main", " ! [rejected] …", "… % "] }
  ],
  "expect": {
    "tasks": [{ "words": ["git push origin main"], "done": { "at": 6, "where": "Terminal" } }],
    "none": [["run the tests"]]
  }
}
```

- `steps` are observations as capture stores them: one window's **new** lines (what `Differ` reports), with the same `⟦…⟧` section lines, `at` minutes after `start` (local time). Optional `url` and `source` (`ax`, `ocr`).
- `family` (SCR-82): the tool the tasks come from, one of `FAMILIES` in `run.ts`: an assistant (`claude-app`, `chatgpt`, `gemini`, `copilot`), a terminal agent (`claude-code`, `codex`, `gemini-cli`, `copilot-cli`, `aider`, `opencode`, `goose`), an editor agent (`vscode-copilot`, `cursor`, `windsurf`, `devin`), or `editor` (a document), `email`, `messaging`, `notes`, `first-day` (a new user's first session across tools) and `done-target` (where a step is done, and near-misses that must not tick). Write each tool's text in its real shape, with `⟦Message N⟧` sections only where capture writes them for that app.
- `expect.tasks`: a task matches when every word is in its title (any case); `done` is null when it was never done. `expect.none`: tasks that must not exist, by the same rule.
- Optional `me` (your name, default "Mike Rosen") and `tail` (minutes polled after the last step, default 15: a chat ask waits 10 for your reply).

The engine is polled every half minute from the start to the end, as the live engine polls every few seconds.

Labels say what really happened, not what the engine does today: a scenario the engine gets wrong stays wrong in the table until the engine is fixed.
