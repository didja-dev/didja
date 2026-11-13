#!/usr/bin/env python3
"""Keep personal content out of the repository (git hooks and CI).

What it blocks, in lines being added (and in commit messages):
  * private names: everyone Didja knows from your own use (chat names, senders, who asked,
    who forwarded, conversation titles, your own names), read from Didja's database on this
    Mac and kept in a list outside the repository. Locally only; CI has no such list.
  * email addresses outside a short allowed list of made-up domains
  * phone numbers
in app profile fixtures (profiles/fixtures/*.json, which are public): text longer than a short
message, addresses of real sites, and names that are not on the fixtures' own made-up roster
(profiles/fixtures/names.txt);
and in files being added: screenshots and videos (outside brand/, the rendered docs/images and
the site), and any database file. Secrets are gitleaks' job; the hooks run it too.

    privacy_check.py staged             the pre-commit hook: what is about to be committed
    privacy_check.py message <file>     the commit-msg hook: the commit message
    privacy_check.py range <from> <to>  the pre-push hook / CI: every commit being pushed
    privacy_check.py tree               report on everything tracked now (never blocks)
    privacy_check.py fixtures           check every app profile fixture (profiles/fixtures)
    privacy_check.py terms              rebuild the private list; print only how many terms

Nothing here sends anything anywhere. The private list never enters the repository, and a
match is reported by file and line with the name masked, so it is not copied into logs.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

# The repository being checked (the one the hook runs in; tests point it elsewhere).
ROOT = Path(os.environ.get("DIDJA_REPO", Path(__file__).resolve().parent.parent))
SUPPORT = Path.home() / "Library" / "Application Support" / "Didja"
DB = Path(os.environ.get("DIDJA_DB", SUPPORT / "didja.db"))
# Built from the database; refreshed when older than a day.
TERMS_FILE = Path(os.environ.get("DIDJA_PRIVATE_TERMS", SUPPORT / "private-terms.txt"))
# Names you add by hand, one per line: family, clients, anything the database doesn't know.
EXTRA_FILE = SUPPORT / "private-terms-extra.txt"
# Words that are never personal on their own, and the made-up names the fixtures use.
ALLOW_FILE = Path(__file__).resolve().parent / "privacy-allow.txt"

ALLOWED_EMAIL_DOMAIN = re.compile(
    r"(^|\.)(example\.(com|org|net)|example|test|invalid|localhost|didja\.dev|anthropic\.com|"
    r"users\.noreply\.github\.com|x\.com|x\.org|acme\.com|school\.org|unq\.gbl\.spaces|"
    # Companies' own service addresses, used as senders of automatic mail in tests.
    r"(stripe|github|paypal|google|netflix|expensify|docusign|linear|apple|slack)\.(com|app|net))$", re.I)
# Generated files that only list packages: never personal, and full of "name@version".
SKIPPED = ("bun.lock", "package-lock.json", "Package.resolved", "yarn.lock")
# The domain must end in a word of letters: "pkg@1.2.3" and Teams' "@thread.v2" are not addresses.
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![\w.])")
PHONE = re.compile(r"(?<![\w.])(?:\+\d{1,3}[ \-]?\(?\d{1,4}\)?(?:[ \-]?\d{2,4}){2,4}|05\d-?\d{3}-?\d{4})(?![\w.])")
MEDIA = {".png", ".jpg", ".jpeg", ".gif", ".heic", ".webp", ".tiff", ".bmp", ".mov", ".mp4", ".m4v"}
DATABASES = {".db", ".sqlite", ".sqlite3", ".db-wal", ".db-shm"}
MEDIA_ALLOWED = ("brand/", "docs/images/", "site/public/", "site/og/", "app/Didja/Assets.xcassets/")
HEBREW = re.compile(r"[֐-׿]")
FIXTURES = ROOT / "profiles" / "fixtures"
# The made-up people and chats fixtures may name. Adding one is a visible, reviewed change.
ROSTER = FIXTURES / "names.txt"
MAX_FIXTURE_TEXT = 200
MADE_UP_HOST = re.compile(r"(^|\.)(example\.(com|org|net)|example|test|invalid)$", re.I)
OUTLINE_VALUE = re.compile(r'\b(id|dom|class|title|value|desc|help|url)=("(?:[^"\\]|\\.)*")')
HEBREW_PREFIX = "והבכלמש"


# --- the private list ---------------------------------------------------------------------

def _clean(name: str) -> str:
    name = re.sub(r"\s+via\s+\S+.*$", "", name.strip(), flags=re.I)      # "Sam via Docusign"
    name = re.sub(r"\s*[-–—]\s*[^\s].*$", "", name) if " - " in name or "- " in name else name  # "רונית - מש"א"
    return name.strip(" \"'“”.,:;()[]")


def names_from_db(path: Path = DB) -> tuple[set[str], set[str]]:
    """Read-only from Didja's database: people (chat names, senders, who asked, your own names)
    and phrases (conversation and window titles), which are only ever matched whole."""
    if not path.exists():
        return set(), set()
    out: set[str] = set()
    phrases: set[str] = set()
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        q = lambda sql: [r[0] for r in con.execute(sql) if r[0]]  # noqa: E731
        for kind, ref in con.execute("SELECT kind, ref FROM sources"):
            # "WhatsApp — זלמן", "Claude — Fix the billing page": what follows the app's name.
            if ref and " — " in ref:
                (out if kind in ("chat", "email") else phrases).add(ref.split(" — ", 1)[1])
        out.update(q("SELECT json_extract(criteria, '$.chat.from') FROM tasks"))
        out.update(q("SELECT json_extract(criteria, '$.chat.chat') FROM tasks"))
        for detail in q("SELECT detail FROM evidence WHERE kind = 'origin'"):
            m = re.match(r"From an email: (?:forwarded by (.+?), written by (.+?)|forwarded by (.+?)|(.+?)) — ", detail)
            if m:
                out.update(g for g in m.groups() if g)
        for key in ("my_name",):
            out.update(q(f"SELECT value FROM meta WHERE key = '{key}'"))
        for raw in q("SELECT value FROM meta WHERE key IN ('my_other_names', 'mail_identity')"):
            try:
                value = json.loads(raw)
            except ValueError:
                continue
            if isinstance(value, list):
                out.update(v for v in value if isinstance(v, str))
            elif isinstance(value, dict):
                out.update(v for v in value.values() if isinstance(v, str))
    finally:
        con.close()
    return {c for c in (_clean(n) for n in out) if c}, {p.strip() for p in phrases if p.strip()}


def load_allow() -> set[str]:
    if not ALLOW_FILE.exists():
        return set()
    return {l.strip().lower() for l in ALLOW_FILE.read_text(encoding="utf-8").splitlines()
            if l.strip() and not l.startswith("#")}


def build_terms(names: set[str], allow: set[str], phrases: set[str] = frozenset()) -> list[str]:
    """Whole names, the first word of each name when it is long enough to mean something, and
    whole phrases (conversation titles) of at least 8 characters."""
    terms: set[str] = {p for p in phrases if len(p) >= 8 and p.lower() not in allow}
    for name in names:
        if len(name) >= 3 and name.lower() not in allow and not name.isdigit():
            terms.add(name)
        first = name.split()[0] if name.split() else ""
        if len(first) >= 3 and first.lower() not in allow and not first.isdigit() and "@" not in first:
            terms.add(first)
    return sorted(terms, key=lambda t: (-len(t), t))


def private_terms(refresh: bool = False) -> list[str]:
    if "DIDJA_PRIVATE_TERMS" in os.environ:  # tests, or a list kept somewhere else
        return [t for t in TERMS_FILE.read_text(encoding="utf-8").splitlines() if t.strip()] if TERMS_FILE.exists() else []
    stale = not TERMS_FILE.exists() or time.time() - TERMS_FILE.stat().st_mtime > 86400
    if refresh or stale:
        names, phrases = names_from_db()
        if EXTRA_FILE.exists():
            names |= {l.strip() for l in EXTRA_FILE.read_text(encoding="utf-8").splitlines() if l.strip()}
        terms = build_terms(names, load_allow(), phrases)
        if terms or not TERMS_FILE.exists():
            TERMS_FILE.parent.mkdir(parents=True, exist_ok=True)
            TERMS_FILE.write_text("\n".join(terms) + "\n", encoding="utf-8")
            os.chmod(TERMS_FILE, 0o600)
        return terms
    return [t for t in TERMS_FILE.read_text(encoding="utf-8").splitlines() if t.strip()]


def term_pattern(term: str) -> re.Pattern[str]:
    prefix = f"[{HEBREW_PREFIX}]{{0,2}}" if HEBREW.search(term) else ""
    return re.compile(rf"(?<![\w]){prefix}{re.escape(term)}(?![\w])", re.I)


def mask(term: str) -> str:
    return f"{term[0]}{'•' * (len(term) - 1)} ({len(term)} letters)"


# --- checking -----------------------------------------------------------------------------

class Findings:
    def __init__(self) -> None:
        self.items: list[str] = []

    def add(self, where: str, what: str) -> None:
        self.items.append(f"  {where}: {what}")


def check_text(where: str, text: str, patterns: list[tuple[str, re.Pattern[str]]], found: Findings) -> None:
    for term, pat in patterns:
        if pat.search(text):
            found.add(where, f"private name {mask(term)}")
    for m in EMAIL.finditer(text):
        if not ALLOWED_EMAIL_DOMAIN.search(m.group(1)):
            found.add(where, f"email address at {m.group(1)} (use example.com)")
    for m in PHONE.finditer(text):
        if not re.search(r"0{6,}", re.sub(r"\D", "", m.group(0))):  # +972500000000 is a placeholder
            found.add(where, "phone number")


def roster() -> set[str]:
    if not ROSTER.exists():
        return set()
    return {l.strip().lower() for l in ROSTER.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")}


def profile_hosts() -> set[str]:
    """The sites the profiles themselves are for: a fixture may use their addresses."""
    hosts: set[str] = set()
    for p in [*(ROOT / "profiles").glob("*.json"), *(ROOT / "profiles" / "assistants").glob("*.json")]:
        try:
            match = json.loads(p.read_text(encoding="utf-8")).get("match", {})
        except (ValueError, OSError):
            continue
        hosts.update(h.lower() for h in match.get("hosts", []))
        for prefix in match.get("urlPrefixes", []):
            m = re.match(r"https://([^/]+)", prefix)
            if m:
                hosts.add(m.group(1).lower())
    return hosts


def fixture_texts(data: dict) -> list[str]:
    """Every piece of text a fixture holds: the outline's values, the lines, what is expected."""
    texts: list[str] = []
    for line in data.get("outline", []):
        for _, literal in OUTLINE_VALUE.findall(line):
            try:
                texts.append(json.loads(literal))
            except ValueError:
                texts.append(literal)
    texts += [l for l in data.get("lines", []) if isinstance(l, str)]

    def walk(v) -> None:
        if isinstance(v, str):
            texts.append(v)
        elif isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
    walk(data.get("expect", {}))
    walk([data.get("about", ""), data.get("window", ""), data.get("url", "")])
    return texts


def fixture_names(data: dict) -> set[str]:
    """Who and which chats a fixture names: its messages' senders and chats, its emails' senders."""
    names: set[str] = set()
    expect = data.get("expect", {}) or {}
    for m in expect.get("messages", []) or []:
        for key in ("from", "chat"):
            if m.get(key) and m[key] != "me":
                names.add(m[key])
    for e in expect.get("emails", []) or []:
        sender = (e.get("from") or "").split(",")[0].strip()
        if sender:
            names.add(sender)
    return names


def check_fixture(where: str, raw: str, patterns: list[tuple[str, re.Pattern[str]]], found: Findings,
                  allowed_names: set[str], hosts: set[str]) -> None:
    try:
        data = json.loads(raw)
    except ValueError:
        found.add(where, "not valid JSON")
        return
    for text in fixture_texts(data):
        if len(text) > MAX_FIXTURE_TEXT:
            found.add(where, f"text over {MAX_FIXTURE_TEXT} characters: write a short made-up one instead")
        check_text(where, text, patterns, found)
        for host in re.findall(r"https?://([^/\s\"'?#:]+)", text):
            if not MADE_UP_HOST.search(host) and host.lower() not in hosts:
                found.add(where, f"the address of a real site ({host}): use example.com")
    for name in sorted(fixture_names(data)):
        if name.lower() not in allowed_names:
            found.add(where, f"a name not on profiles/fixtures/names.txt ({mask(name)}): use a made-up one from there")


def check_fixtures(patterns: list[tuple[str, re.Pattern[str]]], found: Findings) -> None:
    allowed, hosts = roster(), profile_hosts()
    # App fixtures, and the AI tools' fixtures in fixtures/assistants (SCR-83).
    for path in sorted(FIXTURES.rglob("*.json")):
        check_fixture(str(path.relative_to(ROOT)), path.read_text(encoding="utf-8"), patterns, found, allowed, hosts)


def added_lines(diff: str):
    """(file, line number, text) for every added line of a unified diff."""
    path, line = None, 0
    for raw in diff.splitlines():
        if raw.startswith("+++ "):
            path = raw[6:] if raw.startswith("+++ b/") else None
        elif raw.startswith("@@"):
            m = re.search(r"\+(\d+)", raw)
            line = int(m.group(1)) if m else 0
        elif path and raw.startswith("+") and not raw.startswith("+++"):
            yield path, line, raw[1:]
            line += 1
        elif path and not raw.startswith("-"):
            line += 1


def check_files(names_status: str, found: Findings) -> None:
    for row in names_status.splitlines():
        parts = row.split("\t")
        if len(parts) < 2 or parts[0][0] not in "AR":
            continue
        path = parts[-1]
        ext = Path(path).suffix.lower()
        if ext in DATABASES or path.endswith((".db-wal", ".db-shm")):
            found.add(path, "a database file")
        elif ext in MEDIA and not path.startswith(MEDIA_ALLOWED):
            found.add(path, "an image or video (screenshots stay in Linear; renders go in docs/images)")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def run_gitleaks(args: list[str], found: Findings) -> None:
    if os.environ.get("DIDJA_SKIP_GITLEAKS"):
        return
    try:
        r = subprocess.run(["gitleaks", *args, "--redact", "--no-banner", "--exit-code", "1"],
                           cwd=ROOT, capture_output=True, text=True)
    except FileNotFoundError:
        found.add("gitleaks", "not installed (brew install gitleaks)")
        return
    if r.returncode != 0:
        found.add("gitleaks", "found a possible secret:\n" + (r.stdout + r.stderr).strip())


def patterns(local: bool) -> list[tuple[str, re.Pattern[str]]]:
    return [(t, term_pattern(t)) for t in private_terms()] if local else []


def main(argv: list[str]) -> int:
    mode = argv[0] if argv else "staged"
    # On CI there is no private list, unless one is given explicitly (the checker's own tests).
    local = not os.environ.get("CI") or "DIDJA_PRIVATE_TERMS" in os.environ
    found = Findings()
    pats = patterns(local) if mode != "terms" else []

    if mode == "terms":
        print(f"{len(private_terms(refresh=True))} private terms in {TERMS_FILE} (not in the repository)")
        return 0
    if mode == "staged":
        for path, n, text in added_lines(git("diff", "--cached", "-U0", "--no-color")):
            if path.endswith(SKIPPED):
                continue
            check_text(f"{path}:{n}", text, pats, found)
        changed = git("diff", "--cached", "--name-status")
        check_files(changed, found)
        if "profiles/fixtures/" in changed or "profiles/" in changed:
            check_fixtures(pats, found)
        run_gitleaks(["git", "--pre-commit", "--staged"], found)
    elif mode == "message":
        text = Path(argv[1]).read_text(encoding="utf-8")
        text = "\n".join(l for l in text.splitlines() if not l.startswith("#"))
        check_text("commit message", text, pats, found)
    elif mode == "range":
        base, head = argv[1], argv[2]
        span = head if set(base) == {"0"} else f"{base}..{head}"
        diff = git("log", "-p", "-U0", "--no-color", "--format=", span) if set(base) == {"0"} else git("diff", "-U0", "--no-color", base, head)
        for path, n, text in added_lines(diff):
            if path.endswith(SKIPPED):
                continue
            check_text(f"{path}:{n}", text, pats, found)
        changed = git("log", "--name-status", "--format=", span)
        check_files(changed, found)
        if "profiles/" in changed:
            check_fixtures(pats, found)
        for sha in git("rev-list", span).split():
            check_text(f"message of {sha[:7]}", git("log", "-1", "--format=%B", sha), pats, found)
        run_gitleaks(["git", f"--log-opts={span}"], found)
    elif mode == "fixtures":
        check_fixtures(pats, found)
    elif mode == "tree":
        for path in git("ls-files").splitlines():
            p = ROOT / path
            if p.suffix.lower() in MEDIA | DATABASES or not p.is_file() or path.endswith(SKIPPED):
                continue
            try:
                for n, text in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
                    check_text(f"{path}:{n}", text, pats, found)
            except UnicodeDecodeError:
                continue
        print("\n".join(found.items) or "nothing found")
        return 0
    else:
        print(__doc__)
        return 2

    if found.items:
        print("Didja privacy check: blocked. Replace these with made-up names, example.com addresses\n"
              "or rendered images (CLAUDE.md, \"Personal content\"):", file=sys.stderr)
        print("\n".join(found.items), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
