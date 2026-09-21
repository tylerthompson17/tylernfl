"""TEMPLATE: an example chart script for Tyler to replace or delete.

It draws the ten best offenses by EPA per play from the site's own
team_stats.json, so it runs offline. Its entry, src/content/charts/
example-template.md, is a draft: it shows in `npm run dev` and never in the
built site. Copy this file to start a real chart, then delete both.

Everything under pipelines/charts/mine/ is Tyler's. This file and the
README are the only two Claude Code wrote here, once, as a starting point.
"""

import json
import sys
from pathlib import Path

# Lets `from charts import style` work however the script is run.
PIPELINES = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PIPELINES))

from charts import style  # noqa: E402

# The chart's name: its SVG is src/content/charts/<SLUG>.svg, and its
# entry must be src/content/charts/<SLUG>.md.
SLUG = 'example-template'


def main() -> None:
    data = json.loads((PIPELINES.parent / 'src' / 'data' / 'team_stats.json').read_text())
    teams = sorted(
        (t for t in data['teams'] if t['values']['off_epa']['value'] is not None),
        key=lambda t: t['values']['off_epa']['value'],
    )[-10:]

    fig, ax = style.figure(height_px=360)
    names = [t['abbr'] for t in teams]
    values = [t['values']['off_epa']['value'] for t in teams]
    rows = range(len(teams))
    ax.barh(rows, values, color=style.LINK, height=0.6)
    for row, name, value in zip(rows, names, values):
        # The team's logo at the base of its bar stands in for a text label.
        style.team_logo(ax, name, 0, row, size_px=22, xybox=(-16, 0), boxcoords='offset points')
        ax.annotate(f'{value:+.3f}', (value, row), xytext=(4, 0), textcoords='offset points',
                    va='center', fontsize=style.SMALL_PX, color=style.TEXT)
    ax.set_yticks([])
    ax.set_xlabel('Offense EPA per play')
    ax.grid(axis='y', visible=False)
    ax.spines['left'].set_visible(False)

    style.save(fig, SLUG)


if __name__ == '__main__':
    main()
