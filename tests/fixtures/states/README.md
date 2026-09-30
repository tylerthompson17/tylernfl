# Date state fixtures

The site's data as it read at four moments, so the audit can load the site on
a Sunday during games, a Tuesday after the week, a Wednesday looking ahead, and
in the offseason (`node scripts/audit-pages.ts --state <name> ...`). Each folder
has the same layout as `src/data/` (without `types.ts`), and `states.json` gives
each state's moment, which the audit's build uses as `SITE_NOW`.

| State | Site time | What it shows |
|---|---|---|
| `sunday` | 2026-09-20, 2:30 PM Eastern | Week 2: Thursday's game final, the 1 PM games in progress, the late games not started |
| `tuesday` | 2026-09-29, 10 AM Eastern | Week 3, every game final |
| `wednesday` | 2026-09-23, noon Eastern | The ticker on week 3's schedule, no game played yet |
| `offseason` | 2026-06-15, noon Eastern | 2025 complete, 2026's opener announced |

The folders are gitignored and generated on demand: `audit-pages.ts --state`
runs `generate.py` for a state the first time it is used (a minute or two,
through the pipelines' virtual environment and nflverse), and again whenever
the pipeline code has changed since: each set's `generated.json` keeps a hash of
the pipelines, `generate.py` and `states.json` (`generate.py --hash`), and a set
whose hash differs is regenerated and rebuilt. `--regenerate` forces it. Only `states.json`, `generate.py` and this README are committed.
By hand:

    pipelines/.venv/bin/python tests/fixtures/states/generate.py [state ...]

Because a set is made from nflverse as it is on the day it is generated (and
season rosters are always today's), two sets of the same state can differ
slightly. Each carries `generated.json` with when it was made, and the audit's
report includes it.

It runs the real daily pipeline as of the run before each moment (6 AM
Eastern), hiding every score, stat and play from after that, and every betting
line for a game more than a week after it (lines appear about a week ahead). A change to the pipelines regenerates the sets on their next use. See its
docstring for what cannot be dated (season rosters and the player table are
today's) and for the trimmed chart archive (the day's pick and each team's
newest chart only).

The Sunday state's live scores come from `tests/fixtures/espn/`, served by the
audit in place of ESPN. No Sunday was captured in progress, so those files are
derived (`tests/fixtures/espn/derive_sunday.py`) and their scores are made up.
