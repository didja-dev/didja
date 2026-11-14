# Every connection Didja makes

Didja reads your screen, so you should not have to take "it stays on your Mac" on trust. This page lists every network connection Didja can make, checked against the code, and shows how to watch them yourself with a firewall. `engine/test/network.test.ts` fails if network code appears anywhere this page does not list.

## The list

| What | Host | When | What is sent | How to turn it off |
|---|---|---|---|---|
| Update check | `didja.dev` (HTTPS, `/appcast.xml`) | Once a day, and when you choose Check for Updates… | A normal request for the file; Sparkle adds the app's name and version in its User-Agent. Nothing about you or your screen. | Settings › General › Check for updates. Never in Debug builds or tests. |
| Update download | `github.com` and GitHub's download host (`objects.githubusercontent.com`) | Only when an update is found and you install it | A request for the new `Didja.dmg` | Same switch; or don't install the update. An update installs only with a valid EdDSA signature. |
| Connections | The MCP server of each task tool you connect: `mcp.linear.app`, `mcp.atlassian.com` (Jira), `mcp.asana.com`, `ai.todoist.net`, `mcp.notion.com`, plus that tool's sign-in host during sign-in | Only once you connect a tool: every 5 minutes, and when Didja ticks one of its items | Requests for your items there, and the state or label change for an item Didja ticks. Never screen text, observations, evidence or tasks from any other source. | Settings › Connections: disconnect the tool. Nothing is contacted while none is connected. |
| Sign-in callback | `localhost:33418` (127.0.0.1 and ::1 only) | For up to five minutes while you sign in to a connected tool | Your browser hands the sign-in code back to Didja on this Mac | Not connecting a tool. It only listens on this Mac. |
| Local model | `127.0.0.1:11434` (Ollama on this Mac) | Only with Settings › General › Use a model in Ollama on: for emails, chat messages, "looks done?" and whose a list is; and to list Ollama's models in Settings | The same text Apple's on-device model is shown, to Ollama on this Mac. The address is fixed to 127.0.0.1, and the system proxy is not used. | Settings › General › Use a model in Ollama (off by default). |

Nothing else. In particular:

- **No analytics, crash reporting or telemetry.**
- **Apple's on-device model** (`SystemLanguageModel`) runs on the Mac; Didja never uses Apple's Private Cloud Compute model.
- **The app and its engine** talk through files and standard input and output, not the network. So does **`didja mcp`**, the local MCP server for your own Claude (off by default): your Claude starts it and talks to it over stdio. What your Claude reads through it then goes to your AI provider, as anything you show Claude does; that is Claude's connection, not Didja's.
- **Apple Reminders** (Settings › Connections, off by default, SCR-121): Didja writes task titles to a Reminders list through Apple's EventKit, on this Mac, and makes no connection of its own. If you use iCloud for Reminders, macOS then syncs that list through iCloud like any other, so those titles (and who asked, if you chose it) leave the Mac through Apple's sync, not Didja's.
- **Pages Didja opens for you** (Report a Bug, Suggest a Feature, a task's link, Report a Problem's GitHub link or email) open in your browser or mail app. Your browser makes that connection, when you click; Didja sends nothing itself.

## Watch it with LuLu (free)

[LuLu](https://objective-see.org/products/lulu.html) is a free, open-source firewall that asks you about each new outgoing connection.

1. Install LuLu and allow its network extension when macOS asks.
2. In LuLu's settings, turn off **Allow Apple programs** if you want to see everything, and keep **Passive mode** off so it asks you.
3. Open Didja and use it as usual. Each connection from the list above shows up as an alert from **Didja** (the app, `dev.didja.app`), or from **didja** (its engine, inside `Didja.app/Contents/Helpers/`) for Connections. Choose Allow or Block.
4. To see a connection on demand: Quick View › … › Help › **Check for Updates…** shows the `didja.dev` request.
5. LuLu's **Rules** window lists what Didja has asked for. With no task tool connected and Ollama off, the only entry should be `didja.dev`.

Blocking everything is fine: Didja keeps working. Updates stop, and connected tools stop syncing.

## Watch it with Little Snitch

[Little Snitch](https://www.obdev.at/products/littlesnitch/) (paid, with a free demo mode) shows live traffic per app.

1. Install Little Snitch. In **Alert mode** it asks about each new connection, the same way LuLu does.
2. Open **Network Monitor** (from its menu bar icon) and type `Didja` in the search field. You see the app and its `didja` engine, each with the hosts it contacted, how many bytes, and when.
3. Use Didja for a while. With no task tool connected and Ollama off, the only remote host should be `didja.dev`, once a day. Connections to `127.0.0.1` (Ollama) happen only with the local model on, and stay on this Mac.
4. To block updates as well, deny `didja.dev` for Didja in **Rules**.

## Checking the code yourself

Every network call is in one of these files:

- `app/Didja/Updates.swift` and `app/Didja-Info.plist` (Sparkle: `SUFeedURL`, the daily interval, the public key).
- `engine/src/connections.ts` (MCP transports for Connections, and the sign-in callback).
- `app/Didja/LocalModel.swift` (Ollama on 127.0.0.1).

Search the repository for `URLSession`, `fetch(`, `Transport`, `Bun.serve`, `WebSocket` and `node:net` to see that there are no others. The test above does the same search on every build.
