"""Download team logos for charts into public/logos/<ABBR>.png.

Logos are taken from nflverse team data (load_teams), never typed in by
hand, and never from ESPN: the data contract keeps ESPN out of pipelines,
which rules out nflverse's team_logo_espn column.

LOGO_COLUMN picks the set. As of September 2026:
- team_logo_squared is hosted by nflverse itself and complete: each logo
  cropped onto a square of the team's color, 200 x 200.
- team_logo_wikipedia is the full logo on transparent ground, but nflverse's
  links point at thumbnail widths Wikimedia no longer serves, and two teams'
  files (KC, LAR) have since been renamed. Not usable as is.

Charts do not embed the pictures. style.save() writes a reference
("logo:BUF") and the site points it at public/logos/BUF.png under its base
path, so each logo downloads once and every chart shares it.

Logos change rarely; run this by hand after a rebrand, from the repo root:
    python pipelines/build_logos.py
"""

import io
import ssl
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import normalize_team  # noqa: E402

LOGO_COLUMN = 'team_logo_squared'
OUT_DIR = Path(__file__).resolve().parent.parent / 'public' / 'logos'
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


def main() -> None:
    import nflreadpy as nfl
    from PIL import Image  # installed with matplotlib

    urls = logo_urls(nfl.load_teams().to_dicts())
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for abbr, url in sorted(urls.items()):
        image = Image.open(io.BytesIO(fetch(url))).convert('RGBA')
        image.thumbnail((SIZE_PX, SIZE_PX), Image.LANCZOS)
        out = io.BytesIO()
        image.save(out, 'PNG', optimize=True)
        path = OUT_DIR / f'{abbr}.png'
        if not path.exists() or path.read_bytes() != out.getvalue():
            path.write_bytes(out.getvalue())
            print(f'public/logos/{abbr}.png: updated')
    print(f'{len(urls)} logos from {LOGO_COLUMN}')


if __name__ == '__main__':
    main()
