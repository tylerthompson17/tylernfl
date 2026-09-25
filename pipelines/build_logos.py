"""Download team logos for charts into public/logos/<ABBR>.png.

Logos are taken from nflverse team data (load_teams), never typed in by
hand. The data contract keeps ESPN out of the pipelines, and that is about
data: scores, stats, schedules and lines are nflverse's. A logo is artwork,
not data, so the column it comes from is allowed to be ESPN's.

LOGO_COLUMN picks the set. Checked again in September 2026:
- team_logo_espn is the logo on transparent ground, 500 x 500, and every
  team resolves. The one complete transparent set nflverse points at, and
  what charts want: on a scatter, a square of colour hides the chart under
  it and reads as a tile rather than a team.
- team_logo_squared is hosted by nflverse itself and complete, but it is
  each logo cropped onto a square of the team's colour, fully opaque. It
  was the first choice here and is why the EPA chart was 32 blocks of
  colour. Cutting the square away does not work: half the league's logos
  are white where the fill would go, so the Bills' buffalo, the Cowboys'
  star and the Lions all disappear with it.
- team_logo_wikipedia is transparent too, but nflverse's links point at
  thumbnail widths Wikimedia answers with 400, asking for a width it does
  serve gets rate limited, and two teams' files (KC, LAR) have since been
  renamed. Not usable as is.

Charts do not embed the pictures. style.save() writes a reference
("logo:BUF") and the site points it at the file under its base path, so
each logo downloads once and every chart shares it.

The filename carries a hash of the picture (BUF.a1b2c3d4.png) and
src/data/logos.json maps each team to its current one. A new logo is a new
name, so it replaces the old one everywhere the moment a deploy lands,
rather than waiting out the 10 minutes GitHub Pages lets a browser keep a
file. The generation before this one is kept: a page cached across that
deploy still asks for the old name, and a stale logo beats a broken one.

Logos change rarely; run this by hand after a rebrand, from the repo root:
    python pipelines/build_logos.py
"""

import hashlib
import io
import json
import ssl
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import DATA_DIR, normalize_team, write_json_if_changed  # noqa: E402

LOGO_COLUMN = 'team_logo_espn'
OUT_DIR = Path(__file__).resolve().parent.parent / 'public' / 'logos'
MANIFEST = 'logos.json'
# Shown at about 24 px; 96 leaves room for high density screens.
SIZE_PX = 96
DEFUNCT = {'OAK', 'SD', 'STL'}


def fetch(url: str) -> bytes:
    # Some macOS Python installs ship without root certificates; use
    # certifi's bundle when it is available (as build_teams.py does).
    context = None
    try:
        import certifi

        context = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    request = urllib.request.Request(url, headers={'User-Agent': 'tylernfl-pipelines (personal site)'})
    with urllib.request.urlopen(request, context=context) as response:
        return response.read()


def logo_urls(teams: list[dict]) -> dict[str, str]:
    """Team abbreviation (as the site writes it) to logo URL."""
    urls = {}
    for row in teams:
        abbr = row['team_abbr']
        if abbr in DEFUNCT or not row.get(LOGO_COLUMN):
            continue
        # nflverse lists the Rams as both LA and LAR; the site uses LAR.
        urls.setdefault(normalize_team(abbr), row[LOGO_COLUMN])
    return urls


def versioned_name(abbr: str, picture: bytes) -> str:
    """BUF.a1b2c3d4.png: the name changes when the picture does, and only
    then, so an unchanged logo is not rewritten on every run."""
    return f'{abbr}.{hashlib.sha256(picture).hexdigest()[:8]}.png'


def stale_files(existing: set[str], current: dict[str, str], previous: dict[str, str]) -> set[str]:
    """Which files in public/logos/ to delete: everything except what this
    run wrote and what the run before it wrote. Keeping one generation
    means a page cached across the deploy still finds the logo it asks
    for, since GitHub Pages lets a browser hold a page for 10 minutes."""
    keep = set(current.values()) | set(previous.values())
    return {name for name in existing if name not in keep}


def main() -> None:
    import nflreadpy as nfl
    from PIL import Image  # installed with matplotlib

    urls = logo_urls(nfl.load_teams().to_dicts())
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = DATA_DIR / MANIFEST
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    manifest = {}
    for abbr, url in sorted(urls.items()):
        image = Image.open(io.BytesIO(fetch(url))).convert('RGBA')
        image.thumbnail((SIZE_PX, SIZE_PX), Image.LANCZOS)
        out = io.BytesIO()
        image.save(out, 'PNG', optimize=True)
        picture = out.getvalue()
        name = manifest[abbr] = versioned_name(abbr, picture)
        path = OUT_DIR / name
        if not path.exists():
            path.write_bytes(picture)
            print(f'public/logos/{name}: written')

    for name in sorted(stale_files({p.name for p in OUT_DIR.glob('*.png')}, manifest, previous)):
        (OUT_DIR / name).unlink()
        print(f'public/logos/{name}: removed')

    write_json_if_changed(MANIFEST, manifest)
    print(f'{len(urls)} logos from {LOGO_COLUMN}')


if __name__ == '__main__':
    main()
