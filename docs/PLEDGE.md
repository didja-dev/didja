# Your data outlives Didja

Didja reads your screen and holds your tasks. Here is what you can count on, even if the project changes hands or stops.

## The pledge

1. **The code stays MIT.** Didja is released under the [MIT licence](../LICENSE), and you can keep using, copying and changing every version released under it, under the same terms. Future versions in this repository are MIT too. There is no paid edition, no source-available tier and no licence key.
2. **Didja never needs a server to work.** Capture, the engine, the language model (Apple's on-device model, or yours in Ollama) and your tasks are all on your Mac. There is no account, no sign-in to Didja and no licence check. The one request Didja makes on its own is the daily update check to didja.dev, which you can turn off (Settings › General); if didja.dev went away, Didja would keep working and only updates would stop. Connected task tools are reached only once you connect them. Every connection is listed in [NETWORK.md](NETWORK.md).
3. **Your data is in an open, documented format.** Everything is in one SQLite file. Its schema is in [`schema/`](../schema), one numbered SQL step per change, only ever added to, and described in [ARCHITECTURE.md](ARCHITECTURE.md). Columns holding screen text are sealed with AES-256-GCM, in a documented layout ([`engine/src/sealed.ts`](../engine/src/sealed.ts)), with a key in your own login Keychain.
4. **You can take your tasks with you.** **Export All Tasks** writes every task to a file you keep, in Markdown to read or JSON to import elsewhere. Nothing is sent.

## Export All Tasks

- In the app: **Settings › General › Tasks › Export all tasks**, then **Export…** › **Markdown…** or **JSON…**, and choose where to save.
- From a terminal: `didja export [md|json] [--context] [--out <file>]` (the engine is in `Didja.app/Contents/Helpers/didja`). It prints the export, or writes it to `<file>` readable only by you.

Each task carries its title (and the words it was captured with, if you renamed it), its status (open, snoozed, done, dismissed), where it came from (the kind of source and its name, such as "Slack — #launch"), when it was made, last seen, done, snoozed until and due, whether it is a checklist and which checklist a step belongs to, and why it is there and what would tick it (as `didja why` says it).

The few lines kept beside each open task are screen text, so they are left out unless you ask: tick **With kept lines** in the app, or pass `--context`. Observations, evidence, what Didja learned and its logs are never exported.

The JSON has `app: "Didja"`, `format: 1`, `exportedAt`, `withContext` and `tasks`. The format number changes only if a field changes meaning or goes away; new fields may be added without it.

## Reading the database without Didja

The database is `~/Library/Application Support/Didja/didja.db`. Any SQLite tool opens it:

```bash
sqlite3 ~/Library/Application\ Support/Didja/didja.db "SELECT id, status, title FROM tasks ORDER BY id"
```

Task titles, statuses and dates are plain columns. Captured text, the lines kept with open tasks and an email task's note start with `enc1:`: base64 of a 12-byte nonce, the ciphertext and a 16-byte tag (AES-256-GCM, the same layout as CryptoKit's `SealedBox.combined`). The key is the Keychain item "Didja database key" (service `dev.didja.database-key`), 32 bytes. Captured text is deleted after 24 hours anyway, so for your tasks the export is the easier way.
