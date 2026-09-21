"""Redraw Tyler's charts: runs the scripts in pipelines/charts/mine/.

Run from the repo root:
    python pipelines/charts/build.py              every script in mine/
    python pipelines/charts/build.py epa_tiers    just mine/epa_tiers.py

Each script draws its own chart and saves it with style.save(); this only
runs them, so a script also works on its own:
    python pipelines/charts/mine/epa_tiers.py

Not part of the daily job: these charts change when Tyler redraws them.
"""

import runpy
import sys
from pathlib import Path

MINE = Path(__file__).resolve().parent / 'mine'


def scripts(names: list[str]) -> list[Path]:
    if not names:
        return sorted(p for p in MINE.glob('*.py') if not p.name.startswith('_'))
    found = []
    for name in names:
        path = MINE / (name if name.endswith('.py') else f'{name}.py')
        if not path.exists():
            sys.exit(f'No chart script {path.relative_to(MINE.parent.parent.parent)}')
        found.append(path)
    return found


def main() -> None:
    for path in scripts(sys.argv[1:]):
        print(f'{path.name}:')
        runpy.run_path(str(path), run_name='__main__')


if __name__ == '__main__':
    main()
