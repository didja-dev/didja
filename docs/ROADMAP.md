# Roadmap

## Milestone 1 — Native capture + Claude checklists

Capture layer writes observations (AX first, OCR fallback, exclude list, 24h TTL); `didja observations --tail` shows them live. Engine detects numbered checklists in Claude desktop, claude.ai and Claude Code terminal windows, stores tasks; `didja tasks` lists them. No auto-complete yet.

## Milestone 2 — Exact-marker completion

Extract markers at capture time; tick tasks on marker + context match; evidence log.

## Milestone 3 — Menu bar app

SwiftUI MenuBarExtra reading the SQLite store; tick/snooze/confirm.

Done: a menu bar panel showing the task tree (any depth, foldable, renamable), with tick, snooze, dismiss and "why" on every row, a global hot key and full keyboard control; a task window with views by state and by conversation and a detail pane; launch at login; a welcome screen covering what is read and the permissions. The look follows the design at https://claude.ai/artifact/61VGCL59hrmsy7KJg2nUHo.

Also done: Focus (show one app's tasks only) and a choice of order (by source, or latest activity first); a reminder for checklists left unfinished, a pause hot key, search in the panel and the task window, Collapse All in the task window, finished work by day, and an app icon.

## Milestone 4 — Fuzzy completion + email

Model-judged completion with confirm prompts; email reply-needed capture and reply detection.

Already in place: Apple's on-device model (Foundation Models) decides whether a list is for the user when its wording does not say, writes short checklist titles, and judges whether a task with nothing exact to match looks done, asking for a yes or no instead of ticking.

Email is in place for Outlook for Mac, and for Gmail and Outlook on the web in a browser: an open email that asks something of you becomes a task named after the thing to do, and where an answer is wanted, your reply in that conversation asks you to confirm.

Still to do: Apple Mail. There is no Apple Mail profile yet, so its emails do not become tasks.

Also in place: a model in Ollama on this Mac, off by default, asked first for emails, "looks done?" and who a list is for, with Apple's model as the fallback.

## Milestone 5 — Privacy hardening

Exclude list UI, retention limits, redaction before any cloud call.

Done: an Exclude List window (apps picked from those open, window titles by the words they contain, sites by name) that applies at once and deletes what was already kept from anything added; a choice of how long captured text is kept (1, 6 or 24 hours, never more) and a way to delete all of it at once.

## Milestone 6 — Windows

UI Automation + Windows.Media.Ocr capture writing the same observations schema; engine unchanged.

## Open questions

- Optional integrations (Gmail, Linear) later, as confirmation signals only.
- Shipping: `scripts/release.sh` makes a Developer ID signed, notarised disk image (SCR-19). Automatic updates are in place (Sparkle, SCR-33), and a tagged release builds, notarises and publishes itself.
- Freemium: which features are paid, and how a licence is checked without the app phoning home.
- Windows (Milestone 6) is deferred.
