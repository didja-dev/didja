# Fixing how Didja reads an app, with your own Claude

Didja reads chat and email apps through **app profiles** ([profiles/README.md](../profiles/README.md)). When it misreads one, your own Claude (Claude Code or Claude Desktop) can help you find out why and write a fix, through `didja mcp`, a small server built into Didja that only runs on your Mac.

This page is for you and for your Claude. If you are Claude: read all of it before you use the tools, and follow **The rules** below.

## Set it up

1. In Didja: **Settings › General › Let My Own Claude Read Didja**. Until it is on, every tool answers "turned off" and returns nothing.
2. Add the server to your Claude. The path is the engine inside your copy of Didja; Settings shows the exact command.
   - Claude Code:
     ```bash
     claude mcp add didja -- "/Applications/Didja.app/Contents/Helpers/didja" mcp
     ```
   - Claude Desktop: **Add Didja to Claude Desktop…** in Didja Missed This… writes this for you (after asking, keeping a backup); or add it yourself to `claude_desktop_config.json`, then restart Claude:
     ```json
     { "mcpServers": { "didja": { "command": "/Applications/Didja.app/Contents/Helpers/didja", "args": ["mcp"] } } }
     ```
3. Click in the app Didja misreads, then choose **Report a Problem with This Window…** in Didja's "…" menu. Look through the file. Show any lines your Claude needs to see as they are (each is masked until you click it), then click **Give to My Claude**.

## What your Claude can see

| Tool | What it returns |
| --- | --- |
| `list_reports`, `read_report` | The reports you gave it, exactly as you left them: the window's outline (roles, ids, class names), what capture keeps, what Didja kept and the tasks it made. Masked, except the lines you chose to show. |
| `observations` | The latest lines Didja kept from one app (at most 200), masked: every letter x, every digit 0, except the words apps use in their own labels ("from", "Received", "October"). |
| `why` | What would tick a task and what has been seen so far, masked. |
| `missed_report` | A task the user finished that Didja did not notice: what would tick it, how it looked, where Didja looks for it done, and the places and screens it saw since, masked with sites kept. Help the user find where they did it; they teach it in Didja (Didja Missed This…). |
| `list_profiles`, `show_profile` | The profiles in Didja, and your drafts. These hold no personal data. |
| `draft_profile` | Writes a profile and its fixtures into your drafts folder (`~/Library/Application Support/Didja/Profile drafts`), nowhere else, after checking its shape, then runs every fixture. |
| `draft_issue` | A GitHub issue about a miss, for the user to post on `didja-dev/didja`. You give the task (or report), the kind (`missed-task` or `app-support`), a miss type in lowercase words joined by hyphens, and your diagnosis in general words (what was missed, the likely cause, a suggested fix). Didja writes the rest from what it knows (app, bundle id, profile, versions, what capture kept, masked by Didja) and refuses a draft whose words hold anything from the user's screen or tasks, an email address, a link with a path, or a number of three or more digits. It returns the title, the body, a link that opens the issue form filled in (or the bare form and the body to paste, when the body is too long for a link), and a search for issues with the same fingerprint (`<bundle id>:<miss type>`). It posts nothing. |
| `test_profile` | Runs one fixture through Didja's own capture (with your drafts in place) and through the engine: the lines kept, whether they match, and what the engine makes of them. |

It cannot read your screen, unmasked text you did not choose to show, or files outside its two folders. It sends nothing anywhere itself. **What it returns does go to your AI provider**, as anything you show Claude does. That is why it starts only when you turn it on, masks what Didja kept, and logs every call (Privacy shows how many and when; `didja mcp log` lists them).

## The rules (for Claude)

1. **Show the user every file before it leaves this Mac.** Before anything goes to GitHub (an issue, a fork, a pull request), show the user the full text of each file and wait for their yes.
2. **Fixtures hold made-up text only.** Copy the shape of what the report shows (roles, ids, classes, punctuation, label words), and write all the words yourself. Use names from `profiles/fixtures/names.txt` (Sam Carter, Dana Levi, Ron Cohen…), `example.com` addresses, and no real messages, names, numbers or company names, even ones the user chose to show you. The repository's privacy check refuses anything else.
3. **A wrong tick is the bug Didja exists to prevent.** For a chat app, add a fixture where someone other than the user answers an ask meant for them; it must stay in `open`. Never label a message "me" unless the app plainly says it is the user's.
4. **Offer an issue once you know the cause.** After a diagnosis, offer to report it with `draft_issue`. Show the user the whole draft. Search for its fingerprint first: if an issue has it, offer a 👍 or a comment there instead. The user opens the link to post it; if GitHub is connected to you (a connector or `gh`), you may file it yourself only after they approve that exact text.
5. **Change only the profile and its fixtures.** A profile can only label the window Didja already reads. If an app needs more than the rule kinds in profiles/README.md, say so; that is a code change for the maintainers.

## How to fix an app

1. `read_report`: find what marks one message (or email header) in the outline: a role, an `id=`, a `dom=` id, or a `class=` name. Find where the sender, the time and the text sit under it. For an app that is not yet supported, `list_profiles` shows the closest existing one to start from.
2. Draft the profile (`"status": "communityNew"`) and one or more fixtures, then `draft_profile`. Each fixture's `lines` is what capture should keep. Leave `expect` out at first: `test_profile` shows what the engine makes of the lines; when it is right, put it in `expect`.
3. Iterate with `test_profile` until `capture.matches` and `engineMatches` are both true.
4. Show the user the files (rule 1). To contribute: fork `didja-dev/didja`, copy the profile into `profiles/` and the fixtures into `profiles/fixtures/`, run the tests in [CONTRIBUTING.md](../CONTRIBUTING.md), commit with `git commit -s`, and open a pull request. The maintainers review every profile.

The user can also try a draft on their own Mac by running a fixture with `Didja --profile-test <fixture> --profiles "<drafts folder>"`. Didja's capture uses only the profiles that ship inside a signed release.
