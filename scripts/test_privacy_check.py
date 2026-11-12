"""Tests for scripts/privacy_check.py:  python3 -I -m unittest discover -s scripts -p 'test_*.py'"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import privacy_check as pc  # noqa: E402


def findings(text, terms=()):
    found = pc.Findings()
    pc.check_text("f:1", text, [(t, pc.term_pattern(t)) for t in terms], found)
    return found.items


class Terms(unittest.TestCase):
    def test_whole_names_and_first_names_but_not_allowed_or_short_words(self):
        terms = pc.build_terms({"Avi Levinson", "Mike", "Bo", "42"}, {"mike"}, {"Fix the billing page", "Short"})
        self.assertIn("Avi Levinson", terms)
        self.assertIn("Avi", terms)
        self.assertNotIn("Mike", terms, "allowed: a made-up fixture name")
        self.assertNotIn("Bo", terms, "too short to mean anything")
        self.assertNotIn("42", terms)
        self.assertIn("Fix the billing page", terms, "a conversation title, matched whole")
        self.assertNotIn("Fix", terms, "never a title's first word")
        self.assertNotIn("Short", terms)

    def test_names_are_cleaned(self):
        self.assertEqual(pc._clean("Sam Carter via Docusign"), "Sam Carter")
        self.assertEqual(pc._clean('רונית - מש"א'), "רונית")

    def test_names_come_from_the_database_read_only(self):
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "didja.db"
            con = sqlite3.connect(db)
            con.executescript("""
                CREATE TABLE sources (kind TEXT, ref TEXT);
                CREATE TABLE tasks (criteria TEXT);
                CREATE TABLE evidence (kind TEXT, detail TEXT);
                CREATE TABLE meta (key TEXT, value TEXT);
                INSERT INTO sources VALUES ('chat', 'WhatsApp — Avi Levinson'), ('claude-desktop', 'Claude — Fix the billing page');
                INSERT INTO tasks VALUES ('{"chat": {"from": "Dora Klein", "chat": "Family"}}');
                INSERT INTO evidence VALUES ('origin', 'From an email: forwarded by Gil Ash, written by Ora Tal — “x”'),
                                           ('origin', 'From an email: forwarded by Eli Bar — “y”');
                INSERT INTO meta VALUES ('my_name', 'Rafi Sela'), ('my_other_names', '["רפי"]');
            """)
            con.close()
            people, phrases = pc.names_from_db(db)
        self.assertTrue({"Avi Levinson", "Dora Klein", "Family", "Gil Ash", "Ora Tal", "Eli Bar", "Rafi Sela", "רפי"} <= people)
        self.assertEqual(phrases, {"Fix the billing page"})


class Matching(unittest.TestCase):
    def test_a_private_name_is_found_whole_and_masked(self):
        items = findings("Send Avi the file", ["Avi"])
        self.assertEqual(len(items), 1)
        self.assertNotIn("Avi", items[0], "the name itself is never printed")
        self.assertEqual(findings("Avid readers", ["Avi"]), [], "only whole words")

    def test_hebrew_names_are_found_with_a_prefix_letter(self):
        self.assertEqual(len(findings("תשלח לזלמן את הקובץ", ["זלמן"])), 1)
        self.assertEqual(len(findings("זלמן כתב", ["זלמן"])), 1)

    def test_email_addresses_outside_made_up_domains(self):
        # Built here, so the test file itself holds no address the hook would refuse.
        self.assertEqual(len(findings("write to dora" + "@" + "klein-family.net")), 1)
        self.assertEqual(findings("me@example.com, hello@didja.dev, a@x.com, service@paypal.com"), [])
        self.assertEqual(findings('"@modelcontextprotocol/sdk@1.2.3" and 19:abc@thread.v2'), [], "not addresses")

    def test_phone_numbers_but_not_placeholders(self):
        self.assertEqual(len(findings("call me on +" + "972 54 123 4567")), 1)
        self.assertEqual(len(findings("05" + "4-123-4567")), 1)
        self.assertEqual(findings("tel:+972500000000"), [])
        self.assertEqual(findings("id 1794312000 and 2026-11-10"), [])


class Diffs(unittest.TestCase):
    def test_added_lines_carry_their_file_and_line(self):
        diff = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,0 +5,2 @@\n+one\n+two\n"
        self.assertEqual(list(pc.added_lines(diff)), [("x", 5, "one"), ("x", 6, "two")])

    def test_screenshots_and_databases_are_refused_where_they_do_not_belong(self):
        found = pc.Findings()
        pc.check_files("A\tdocs/bug.png\nA\tdocs/images/panel.png\nA\tbrand/x.png\nA\tdata/didja.db\nM\tREADME.md", found)
        self.assertEqual([i.split(":")[0].strip() for i in found.items], ["docs/bug.png", "data/didja.db"])


class FixtureChecks(unittest.TestCase):
    def fixture(self, **over):
        data = {
            "about": "A made-up chat", "profile": "acme", "app": "com.example.acme",
            "outline": ["AXWindow", ' AXGroup desc="Message from Sam Carter, Hi, 10:00"'],
            "lines": ["Hi"],
            "expect": {"messages": [{"chat": "Family", "from": "Sam Carter", "body": "Hi"}], "open": []},
        }
        data.update(over)
        found = pc.Findings()
        pc.check_fixture("f.json", json.dumps(data, ensure_ascii=False), [], found, {"sam carter", "family"}, {"mail.google.com"})
        return found.items

    def test_a_made_up_fixture_passes(self):
        self.assertEqual(self.fixture(), [])

    def test_names_must_be_on_the_roster(self):
        items = self.fixture(expect={"messages": [{"chat": "Family", "from": "Avi Levinson"}]})
        self.assertEqual(len(items), 1)
        self.assertNotIn("Avi", items[0], "the name itself is never printed")
        self.assertEqual(len(self.fixture(expect={"emails": [{"from": "Avi Levinson, avi@example.com"}]})), 1)

    def test_long_text_real_sites_and_addresses_are_refused(self):
        self.assertEqual(len(self.fixture(lines=["x" * 201])), 1)
        self.assertEqual(len(self.fixture(outline=["AXWindow", ' AXWebArea url="https://intranet.bigcorp.io/x"'])), 1)
        self.assertEqual(self.fixture(outline=["AXWindow", ' AXWebArea url="https://mail.google.com/mail/u/0/"']), [],
                         "a site a profile is for")
        self.assertEqual(self.fixture(outline=["AXWindow", ' AXLink url="https://forms.example.com/f/9"']), [])
        self.assertEqual(len(self.fixture(lines=["write to dora" + "@" + "klein-family.net"])), 1)
        self.assertEqual(len(self.fixture(about="call +" + "972 54 123 4567")), 1)

    def test_a_fixture_that_is_not_json_is_refused(self):
        found = pc.Findings()
        pc.check_fixture("f.json", "{nope", [], found, set(), set())
        self.assertEqual(len(found.items), 1)

    def test_the_repositorys_fixtures_pass(self):
        found = pc.Findings()
        pc.check_fixtures([], found)
        self.assertEqual(found.items, [])


class Hook(unittest.TestCase):
    def test_the_pre_commit_check_blocks_a_private_name_and_passes_made_up_data(self):
        with tempfile.TemporaryDirectory() as d:
            repo = Path(d)
            run = lambda *a: subprocess.run(a, cwd=repo, capture_output=True, text=True)  # noqa: E731
            run("git", "init", "-q")
            terms = repo / "terms.txt"
            terms.write_text("Avi Levinson\nAvi\n", encoding="utf-8")
            env = {**os.environ, "DIDJA_PRIVATE_TERMS": str(terms), "DIDJA_SKIP_GITLEAKS": "1"}
            script = Path(pc.__file__)
            (repo / "t.txt").write_text("Send Avi the contract\n", encoding="utf-8")
            run("git", "add", "t.txt")
            blocked = subprocess.run([sys.executable, "-I", str(script), "staged"], cwd=repo, env={**env, "DIDJA_REPO": str(repo)},
                                     capture_output=True, text=True)
            self.assertEqual(blocked.returncode, 1, blocked.stderr)
            self.assertIn("t.txt:1", blocked.stderr)
            (repo / "t.txt").write_text("Send Mike the contract\n", encoding="utf-8")
            run("git", "add", "t.txt")
            passed = subprocess.run([sys.executable, "-I", str(script), "staged"], cwd=repo, env={**env, "DIDJA_REPO": str(repo)},
                                    capture_output=True, text=True)
            self.assertEqual(passed.returncode, 0, passed.stderr)


if __name__ == "__main__":
    unittest.main()
