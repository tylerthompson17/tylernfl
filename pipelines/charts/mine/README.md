# Your charts

Everything in this folder is yours. Claude Code wrote this README and
`example_template.py` once, as a starting point, and does not write or edit
anything here after that.

A chart is two things: a script here that draws the SVG, and an entry in
`src/content/charts/` that gives it a title, a note and a source. The
`/charts` gallery shows only these charts. (The home page's auto chart is
separate and never appears in the gallery.)

## Add a chart

1. Copy `example_template.py` to a new file, say `epa_tiers.py`.
2. Set `SLUG` to the chart's name, e.g. `epa-tiers`. Lowercase, dashes, not
   all digits, and not `tag`.
3. Draw with `style.figure()` and finish with `style.save(fig, SLUG)`. That
   writes `src/content/charts/epa-tiers.svg`.
4. Run it from the repo root (see below).
5. Write `src/content/charts/epa-tiers.md`:

   ```md
   ---
   title: EPA tiers after week 6
   date: 2026-10-14
   author: Tyler
   tags: [EPA, offense]
   source: nflverse play-by-play
   note: Buffalo is alone in the top tier. The next four are within 0.02 of each other.
   script: epa_tiers.py
   featured: false
   draft: false
   ---
   ```

   `note` is one or two sentences (300 characters at most) on the takeaway.
   `featured: true` pins it to the home page; only one chart can be featured
   at a time, and the build fails if two are. `draft: true` shows it in
   `npm run dev` only.
6. Commit the script, the SVG and the entry together.

The build also fails if an entry has no SVG, or names a script that is not
in this folder.

## Regenerate an SVG

From the repo root, with the pipeline requirements installed
(`pip install -r pipelines/requirements.txt`):

```sh
python pipelines/charts/build.py epa_tiers   # one chart
python pipelines/charts/build.py             # every script in this folder
python pipelines/charts/mine/epa_tiers.py    # or run a script directly
```

Redrawing unchanged data gives a byte-identical SVG, so there is no diff to
commit unless something changed. Files starting with `_` are skipped by
`build.py`, for shared helpers.

## The style module

`from charts import style` (the template sets up the import path):

- `style.figure(width_px=720, height_px=405)`: a figure and axes in the site
  style, sized in pixels. 720 wide matches the chart page at a laptop width.
- `style.SERIES`: five line and bar colors, all readable on white. Use them
  in order.
- `style.LINK`, `style.HEADER`, `style.TEXT`, `style.TEXT_DIM`, `style.RULE`,
  `style.WIN`, `style.LOSS`: the site tokens, read from `tokens.css`.
- `style.HIGHLIGHT`: first-down yellow, for a shaded background band only.
  Never a line, dot or text; it is unreadable on white.
- `style.label_end(ax, x, y, text, color)`: label a line at its end, so the
  chart reads without a legend.
- `style.heading(ax, text, xy=..., ...)`: text in the heading face.
- `style.save(fig, slug)`: writes the SVG, ready to go inline on the page.

Leave the title out of the chart itself: the page shows it above.
