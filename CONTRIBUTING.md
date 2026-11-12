# Contributing

Thanks for helping. Didja is small, so a short issue first is the easiest way to agree on a change before you write it.

## Build and test

You need Xcode 16+ and [Bun](https://bun.sh).

```bash
# engine: tests and type-check
cd engine && bun install && bun test && bunx tsc --noEmit

# app: builds, bundles the engine and runs the Swift tests
xcodebuild -project app/Didja.xcodeproj -scheme Didja -configuration Debug -derivedDataPath app/build test
```

`xcodebuild` prints thousands of lines: send it to a file and look for `error:` and `** TEST`. The engine build leaves `engine/.*.bun-build` temp files; delete them, never commit them.

To build without the maintainer's certificate, add `CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM=` to the `xcodebuild` command. Please don't commit signing changes.

## Keep your own data out

Didja reads your screen, so bug reports and tests are tempting places for real chats and emails. Don't put them there.

- Turn on the checks once per clone: `git config core.hooksPath .githooks` (needs `brew install gitleaks`). They block a commit that adds an email address outside made-up domains, a phone number, a screenshot or a database file, and run gitleaks. If Didja is installed, they also block names from your own chats and mail, read locally from Didja's database (the list stays on your Mac).
- Write tests with made-up people and text (`Sam`, `example.com`), keeping the shape of what you saw. CI runs the same checks, without anyone's names.

## Support a new app

Didja reads chat and email apps through **app profiles**: one JSON file per app in `profiles/`, with a fixture of made-up text that shows what it must read. You don't need to write Swift. [profiles/README.md](profiles/README.md) has the steps and the format; your own Claude can do most of it with you through `didja mcp` ([docs/AGENTS.md](docs/AGENTS.md)).

A profile pull request needs:

- the profile, with `"status": "communityNew"`;
- at least one fixture; for a chat app, one where someone else answers an ask meant for you (it must stay open);
- names only from `profiles/fixtures/names.txt`, no text longer than a short message, and no real sites or addresses. The privacy check refuses anything else.

CI checks the profile and runs every fixture in the app and the engine. The maintainers review every profile before it ships. It reaches people only inside a signed release, never downloaded on its own. A new profile is marked "community, new" in the app for its first release, and one that misreads is turned off in the next.

## Better instructions for the model

If you rewrote one of the model's jobs in **How It Decides…** and it works better for you, **Propose Upstream…** makes a file with your change; attach it to an issue. The maintainers run it on the made-up samples in `engine/eval/` (`bun eval/compare.ts <file>`), and take it only if it gets more right with no new wrong ticks. A job without samples yet (who a list is for, checklist titles) needs some first: made-up examples, like the others.

Where things are: `app/Capture/` reads the screen, `app/Didja/` is the menu bar app, `engine/` (TypeScript) owns every rule about tasks, `schema/` holds the SQLite steps. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how they fit together.

## The rules

These are what users trust Didja with. A change that breaks one won't be merged.

- **No third-party screen recorder.** Capture uses Apple's own APIs only.
- **No pictures.** Never store screenshots or video. OCR frames are read in memory and dropped.
- **Text only, and not for long.** Text is deduplicated per window and expires after 24 hours. The documented exceptions are listed in [docs/DECISIONS.md](docs/DECISIONS.md).
- **Privacy rules come first.** The exclude list applies before anything is read. Secure (password) fields are never read. What a task keeps as evidence is a description the engine writes, never raw screen text.
- **Nothing leaves the Mac.** No network calls, no analytics, and no dependencies that phone home. The only exceptions are the daily update check and the task tools a user connects. The language model is Apple's on-device one, never a cloud model.

## A wrong tick is the bug

A missed tick is cheap: the user ticks it themselves. A wrong tick hides a step the user still has to do, which is the bug Didja exists to prevent. If a change could make ticking looser, add the test that shows it doesn't tick wrongly.

## Every change

- **Comes with a test.** Pure logic is kept apart from Accessibility and SQLite calls so it can be tested.
- **Keeps task rules in the engine.** The app reads tasks from SQLite and changes them only by running the engine.
- **Adds schema only.** A schema change is a new numbered `schema/NNN_name.sql` step ending in `PRAGMA user_version = N`. Never edit an old one.
- **Gets a `docs/CHANGELOG.md` entry** (newest first: what changed, and what was not verified).
- **Records its decisions.** Any choice the code doesn't explain goes in `docs/DECISIONS.md`, with its reason.
- **Updates the docs** (`README.md`, `docs/`) when behaviour changes.
- **Shows UI changes.** The Swift test `testRenderPopoverList` draws the panel to `$TMPDIR/didja-ui/popover.png`. Look at it, and attach it to the pull request.

Keep commits small, with plain messages. When you report a bug, use made-up text instead of screenshots of private content. **Report a Problem with This Window…** in Didja's "…" menu makes a file that shows the window's shape with every letter and digit masked; attach that instead.

## Sign-off and review

- Sign off every commit (`git commit -s`). That certifies the [Developer Certificate of Origin](https://developercertificate.org): you wrote the change, or have the right to submit it under the project's MIT licence. CI checks each commit in a pull request.
- The maintainers review every pull request (`.github/CODEOWNERS`), with Claude Code's help. There is no promised turnaround.
- CI runs the engine's tests on every pull request, the app's tests (macOS) when the app, engine, schema or profiles change, and the privacy checks on everything.
