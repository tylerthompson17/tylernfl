"""Generate src/data/teams.json from nflverse team data.

Fetches teams_colors_logos.csv from the nflverse-data release and writes
the subset the site needs: abbreviation, full name, and the two primary
brand colors. Defunct relocation-era abbreviations are dropped, but both
Rams abbreviations (LA in nflverse play-by-play data, LAR elsewhere) are
kept so lookups work with either.

Run from the repo root:
    python3 pipelines/build_teams.py
or with an already-downloaded copy of the CSV:
    python3 pipelines/build_teams.py path/to/teams_colors_logos.csv
"""

import csv
import io
import json
import ssl
import sys
import urllib.request
from pathlib import Path

SOURCE_URL = (
    'https://github.com/nflverse/nflverse-data/releases/download/'
    'teams/teams_colors_logos.csv'
)
OUT_PATH = Path(__file__).resolve().parent.parent / 'src' / 'data' / 'teams.json'
DEFUNCT = {'OAK', 'SD', 'STL'}


def load_csv() -> str:
    if len(sys.argv) > 1:
        return Path(sys.argv[1]).read_text(encoding='utf-8')
    # Some macOS Python installs ship without root certificates; use
    # certifi's bundle when it is available.
    context = None
    try:
        import certifi

        context = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    with urllib.request.urlopen(SOURCE_URL, context=context) as resp:
        return resp.read().decode('utf-8')


def main() -> None:
    text = load_csv()

    teams = []
    for row in csv.DictReader(io.StringIO(text)):
        if row['team_abbr'] in DEFUNCT:
            continue
        teams.append(
            {
                'abbr': row['team_abbr'],
                'name': row['team_name'],
                'primary': row['team_color'].lower(),
                'secondary': row['team_color2'].lower(),
            }
        )

    teams.sort(key=lambda t: t['abbr'])
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(teams, indent=2) + '\n')
    print(f'Wrote {len(teams)} teams to {OUT_PATH}')


if __name__ == '__main__':
    main()
