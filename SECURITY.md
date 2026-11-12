# Security and privacy

Didja reads what is on your screen, so a privacy bug is a security bug.

## Reporting

Please email **[hello@didja.dev](mailto:hello@didja.dev)** and don't open a public issue. Include the macOS version, the Didja version (Settings › General) and the steps to reproduce. Please don't attach screenshots of private content; describe it, or use made-up text.

You'll get a reply within a few days. Once a fix ships, we'll credit you in the changelog if you'd like.

## What counts

Anything that breaks the promises in the README, for example:

- Text read from an app, window or site on the exclude list, from a password manager, a secure (password) field or a private browser window.
- Anything read, kept or sent that should not be: data leaving the Mac other than the daily update check and the task tools you connected, or any of your screen text, observations or tasks sent to a connected tool.
- Screenshots, video or OCR frames written to disk.
- Captured text kept longer than its limit (24 hours at most), or not deleted by Forget Captured Text Now.
- An update installed without a valid signature.
- A way for another app or a web page to make Didja tick, dismiss or create tasks, or run its bundled engine.

Wrong or missed ticks are ordinary bugs: please report them as an issue.

## Supported versions

Only the latest release gets fixes.
