"""Add one release to the Sparkle appcast (SCR-33), newest first; a version already there is replaced.

    appcast.py <appcast.xml> <version> <build> <download url> '<sparkle:edSignature="…" length="…">' [notes]

The signature attributes are what Sparkle's sign_update prints. Notes are plain text or HTML.
"""
import html
import re
import sys
from email.utils import formatdate


def item(version: str, build: str, url: str, signature: str, notes: str) -> str:
    attributes = re.findall(r'(sparkle:edSignature|length)="([^"]*)"', signature)
    if len(attributes) != 2:
        raise SystemExit(f"Not a sign_update result: {signature!r}")
    attrs = " ".join(f'{k}="{html.escape(v)}"' for k, v in attributes)
    description = f"\n      <description><![CDATA[{notes}]]></description>" if notes else ""
    return (
        f"    <item>\n"
        f"      <title>Version {html.escape(version)}</title>\n"
        f"      <pubDate>{formatdate(usegmt=True)}</pubDate>\n"
        f"      <sparkle:version>{html.escape(build)}</sparkle:version>\n"
        f"      <sparkle:shortVersionString>{html.escape(version)}</sparkle:shortVersionString>\n"
        f"      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>{description}\n"
        f'      <enclosure url="{html.escape(url)}" type="application/octet-stream" {attrs}/>\n'
        f"    </item>\n"
    )


def add(feed: str, version: str, build: str, url: str, signature: str, notes: str = "") -> str:
    # Replace this version if it was published before, then put it first.
    feed = re.sub(
        r"    <item>\n(?:(?!</item>).)*?<sparkle:shortVersionString>" + re.escape(version) + r"</sparkle:shortVersionString>.*?</item>\n",
        "", feed, flags=re.S)
    anchor = feed.find("    <item>")
    if anchor == -1:
        anchor = feed.index("  </channel>")
    return feed[:anchor] + item(version, build, url, signature, notes) + feed[anchor:]


if __name__ == "__main__":
    path, version, build, url, signature = sys.argv[1:6]
    notes = sys.argv[6] if len(sys.argv) > 6 else ""
    with open(path, encoding="utf-8") as f:
        feed = f.read()
    with open(path, "w", encoding="utf-8") as f:
        f.write(add(feed, version, build, url, signature, notes))
