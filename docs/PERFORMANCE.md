# What Didja costs your Mac

Measured, not estimated: CPU, energy impact, memory, and how fast Didja's files grow while it runs. Re-run for each release (see `scripts/release.sh`).

## Latest numbers (2026-11-14, Didja 0.11 development build)

Measured for 10 min on Apple M5 Pro, 64 GB, macOS 27.0.1. Capture on, during an ordinary working session (chat, mail, a browser, a terminal, an AI assistant), with the local Ollama model off.

| Process | CPU median | CPU p95 | Energy impact median | Energy impact p95 | Memory median | Memory peak |
|---|---|---|---|---|---|---|
| App (capture, Quick View, model judge) | 14.1% | 14.5% | 8.1 | 14.1 | 92.6 MB | 92.9 MB |
| Engine (`didja run`, `didja lane`) | 0.5% | 1.0% | 0.0 | 1.6 | 242.2 MB | 252.9 MB |

Database (`didja.db` with its WAL): 15.6 MB, growing 11.5 MB an hour while capturing. Captured text is deleted after 24 hours, so the database levels off after a day instead of growing on. Logs: 522 B, not growing.

- **CPU** is a share of one core (100% = one core fully busy; this Mac has many), from each process's cumulative CPU time (`ps`) over 5-second intervals.
- **Energy impact** is the number Activity Monitor shows, read from `top`'s POWER column.
- **Memory** is resident memory.
- **What was not measured:** a Release build (these numbers are from the Debug build, which is not optimised and may use more CPU); the local Ollama model, which runs in Ollama's own process and uses several GB of memory while loaded; a full hour (`--hour`).

## How to reproduce

With Didja running:

```bash
bun scripts/measure.ts            # 10 minutes, a sample every 5 seconds
bun scripts/measure.ts --hour     # a full hour
```

It prints the table above for your Mac. It only watches: process statistics and the sizes of the files in `~/Library/Application Support/Didja`. It never reads the database or the logs, and never opens a window, moves the pointer or scrolls, so it measures Didja on whatever your Mac shows during the period. Say what was on screen when you share the numbers.
