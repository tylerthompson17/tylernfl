"""Shared chart style: every chart on the site is drawn through this module.

Colors and fonts are read from src/styles/tokens.css rather than copied, so
the site's tokens stay the single source of truth. Use it like this:

    from charts import style

    fig, ax = style.figure()
    ax.plot(weeks, yards, color=style.SERIES[0])
    style.label_end(ax, weeks[-1], yards[-1], 'J.Chase', style.SERIES[0])
    style.save(fig, 'chase-yards-by-week')

save() writes src/content/charts/<slug>.svg. The pages put that SVG inline,
so a few things are done to it on the way out:

- Text stays text (font-family "Barlow"), so the site's own self-hosted
  fonts render it. Nothing is embedded and nothing is fetched.
- The width and height are dropped and the viewBox kept, so the chart
  scales to its panel. Figures are sized in pixels at 1 point = 1 pixel,
  so a 13 px label is 13 px when the chart is shown at its natural width.
- Team logos (team_logo) are not embedded. Each becomes a reference,
  href="logo:BUF", which the site points at public/logos/BUF.png under its
  base path. One download per logo, shared by every chart. Opening the .svg
  file on its own shows empty space where logos go; check it with
  `npm run dev` instead.
- Every id is prefixed with the slug. Several charts share a page on the
  gallery, and matplotlib's ids would otherwise collide.
- matplotlib's global <style> rule is scoped to this chart, so it cannot
  restyle the rest of the page.
- No creation date is written and ids are salted with the slug, so
  redrawing unchanged data gives a byte-identical file and no diff.

Design rules the helpers follow, and your own drawing should too:

- Yellow (HIGHLIGHT) is a background only: a shaded band, never a line,
  a dot or text. It is about 1.4:1 against white.
- Series colors (SERIES) all clear 3:1 against the white panel. Label lines
  directly at their ends (label_end) instead of relying on a legend or on
  color alone.
- No titles inside the chart: the page shows the title above it.
"""

import io
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOKENS_CSS = ROOT / 'src' / 'styles' / 'tokens.css'
LOGO_DIR = ROOT / 'public' / 'logos'
CONTENT_DIR = ROOT / 'src' / 'content' / 'charts'

# Default size: the main column at a common laptop width, 16:9.
WIDTH_PX = 720
HEIGHT_PX = 405

# Sizes from the design spec: body 13 px, tables and small print 12 px.
TEXT_PX = 13
SMALL_PX = 12


def read_tokens(path: Path = TOKENS_CSS) -> dict[str, str]:
    """CSS custom properties from tokens.css, name (without --) to value."""
    css = re.sub(r'/\*.*?\*/', '', path.read_text(), flags=re.S)
    return {name: value.strip() for name, value in re.findall(r'--([\w-]+)\s*:\s*([^;]+);', css)}


def first_family(value: str) -> str:
    """The first family in a CSS font stack: "'Barlow', system-ui" -> "Barlow"."""
    return value.split(',')[0].strip().strip('\'"')


TOKENS = read_tokens()

BG = TOKENS['bg']
PANEL = TOKENS['panel']
HEADER = TOKENS['header']
RULE = TOKENS['rule']
RULE_SOFT = TOKENS['rule-soft']
TEXT = TOKENS['text']
TEXT_DIM = TOKENS['text-dim']
LINK = TOKENS['link']
HIGHLIGHT = TOKENS['highlight']  # background only, never a mark or text
WIN = TOKENS['win']
LOSS = TOKENS['loss']

FONT_BODY = first_family(TOKENS['font-body'])
FONT_HEADING = first_family(TOKENS['font-heading'])

# Up to five series, in the order to use them. Each clears 3:1 on white.
SERIES = [LINK, LOSS, WIN, HEADER, TEXT_DIM]


def apply() -> None:
    """Set matplotlib's defaults to the site style. figure() calls this."""
    import logging

    import matplotlib

    # Barlow is not installed where charts are drawn (the site self-hosts
    # it), so every lookup would warn. That is expected; see font.family.
    logging.getLogger('matplotlib.font_manager').setLevel(logging.ERROR)

    matplotlib.use('svg')
    import matplotlib.pyplot as plt

    plt.rcParams.update({
        'svg.fonttype': 'none',
        # Layout is measured with whatever font matplotlib finds locally
        # (usually DejaVu Sans, which is wider than Barlow), so spacing errs
        # roomy; the browser draws the text in Barlow.
        'font.family': [FONT_BODY, 'DejaVu Sans', 'sans-serif'],
        'font.size': TEXT_PX,
        'text.color': TEXT,
        'axes.labelcolor': TEXT,
        'axes.labelsize': SMALL_PX,
        'axes.edgecolor': RULE,
        'axes.linewidth': 1,
        'axes.facecolor': PANEL,
        'axes.grid': True,
        'axes.axisbelow': True,
        'axes.spines.top': False,
        'axes.spines.right': False,
        'axes.titlesize': TEXT_PX,
        'axes.prop_cycle': matplotlib.cycler(color=SERIES),
        'grid.color': RULE_SOFT,
        'grid.linestyle': (0, (1, 2)),
        'grid.linewidth': 1,
        'xtick.color': RULE,
        'ytick.color': RULE,
        'xtick.labelcolor': TEXT_DIM,
        'ytick.labelcolor': TEXT_DIM,
        'xtick.labelsize': SMALL_PX,
        'ytick.labelsize': SMALL_PX,
        'lines.linewidth': 2,
        'lines.solid_capstyle': 'butt',
        'legend.frameon': False,
        'legend.fontsize': SMALL_PX,
        'figure.facecolor': PANEL,
        'figure.dpi': 72,
        'savefig.dpi': 72,
        'savefig.facecolor': PANEL,
    })


def figure(width_px: int = WIDTH_PX, height_px: int = HEIGHT_PX):
    """A styled figure and one axes, sized in pixels."""
    apply()
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(width_px / 72, height_px / 72), layout='constrained')
    return fig, ax


def heading(ax, text: str, **kwargs) -> None:
    """Text in the heading face (Barlow Condensed, bold), for labels that
    read as headers: quadrant names, a team abbreviation at a line's end."""
    ax.text(*kwargs.pop('xy', (0, 1)), text, family=FONT_HEADING, weight='bold', **kwargs)


def team_logo(ax, team: str, x, y, size_px: int = 24, **kwargs):
    """A team's logo centered on (x, y), size_px square. Pass
    xycoords='axes fraction' to place it relative to the axes instead of
    the data. Logos come from public/logos/ (pipelines/build_logos.py)."""
    import matplotlib.image as mpimg
    from matplotlib.offsetbox import AnnotationBbox, OffsetImage

    path = LOGO_DIR / f'{team}.png'
    if not path.exists():
        raise FileNotFoundError(f'No logo for {team}: run python pipelines/build_logos.py')
    image = mpimg.imread(path)
    box = AnnotationBbox(
        OffsetImage(image, zoom=size_px / max(image.shape[:2])),
        (x, y), frameon=False, pad=0, annotation_clip=False, **kwargs,
    )
    # The id is how save() finds the picture to swap for a reference.
    # Counted per figure, so a chart's ids never depend on what else the
    # same run drew.
    count = getattr(ax.figure, '_team_logos', 0) + 1
    ax.figure._team_logos = count
    box.set_gid(f'logo-{team}-{count}')
    box.set_zorder(kwargs.get('zorder', 4))
    ax.add_artist(box)
    return box


def label_end(ax, x, y, text: str, color: str, dx_px: int = 6, team: str | None = None,
              dy_px: float = 0) -> None:
    """Label a line at its last point, in the line's own color, so the chart
    reads without a legend. With a team, its logo comes first. dy_px moves
    the label up or down; label_ends() uses it to keep labels apart."""
    if team:
        logo_px = 18
        team_logo(ax, team, x, y, size_px=logo_px, xybox=(dx_px + logo_px / 2, dy_px),
                  boxcoords='offset points')
        dx_px += logo_px + 4
    ax.annotate(
        text, (x, y), xytext=(dx_px, dy_px), textcoords='offset points',
        color=color, family=FONT_HEADING, weight='bold', fontsize=SMALL_PX, va='center',
        annotation_clip=False,
    )


def spread(positions: list[float], min_gap: float) -> list[float]:
    """Move positions apart until neighbours are at least min_gap apart,
    keeping their order. Only labels that collide move: each group of
    colliding labels is spaced min_gap apart and centered on the lines it
    labels, and groups that then collide merge. Returns the new positions
    in the order given."""
    order = sorted(range(len(positions)), key=lambda i: positions[i])
    # Each group: the original positions of its labels, bottom to top.
    groups = [[positions[i]] for i in order]

    def layout(group: list[float]) -> list[float]:
        center = sum(group) / len(group)
        start = center - min_gap * (len(group) - 1) / 2
        return [start + min_gap * k for k in range(len(group))]

    merged = True
    while merged:
        merged = False
        for k in range(len(groups) - 1):
            if layout(groups[k + 1])[0] - layout(groups[k])[-1] < min_gap - 1e-9:
                groups[k:k + 2] = [groups[k] + groups[k + 1]]
                merged = True
                break

    placed = [value for group in groups for value in layout(group)]
    result = [0.0] * len(positions)
    for k, i in enumerate(order):
        result[i] = placed[k]
    return result


def label_ends(ax, x, labels: list[tuple], min_gap_px: int = 20) -> None:
    """label_end() for several lines ending at the same x, moved apart so
    none overlap. labels: (y, text, color) or (y, text, color, team).
    Set the axis limits first; the spacing is measured in pixels."""
    ax.figure.draw_without_rendering()
    to_px = lambda y: ax.transData.transform((x, y))[1]
    ys = [to_px(label[0]) for label in labels]
    for label, y_px, placed in zip(labels, ys, spread(ys, min_gap_px)):
        y, text, color, *rest = label
        label_end(ax, x, y, text, color, team=rest[0] if rest else None, dy_px=placed - y_px)


def svg_text(fig, slug: str) -> str:
    """The figure as inline-ready SVG markup."""
    import matplotlib

    buffer = io.StringIO()
    with matplotlib.rc_context({'svg.hashsalt': slug}):
        fig.savefig(buffer, format='svg', metadata={'Date': None, 'Creator': None})
    return inline_svg(buffer.getvalue(), slug)


def inline_svg(svg: str, slug: str) -> str:
    """Make matplotlib's SVG safe to place inline on a page with others."""
    prefix = re.sub(r'[^a-z0-9-]', '-', slug.lower())

    # A standalone file's preamble has no place inside HTML.
    svg = re.sub(r'<\?xml[^>]*\?>\s*', '', svg)
    svg = re.sub(r'<!DOCTYPE[^>]*>\s*', '', svg)
    svg = re.sub(r'<metadata>.*?</metadata>\s*', '', svg, flags=re.S)

    # Logos: the embedded picture becomes a reference the site resolves.
    svg = re.sub(r'(<g id="logo-([A-Z]{2,3})-\d+">\s*)(<image\b[^>]*>)', _logo_reference, svg)

    # Scale to the container: keep the viewBox, drop the fixed size.
    svg = re.sub(r'(<svg\b[^>]*?)\s+width="[^"]*"', r'\1', svg, count=1)
    svg = re.sub(r'(<svg\b[^>]*?)\s+height="[^"]*"', r'\1', svg, count=1)

    # Ids and every reference to them, prefixed so charts cannot collide.
    svg = re.sub(r'\bid="([^"]+)"', lambda m: f'id="{prefix}-{m.group(1)}"', svg)
    svg = re.sub(r'url\(#([^)]+)\)', lambda m: f'url(#{prefix}-{m.group(1)})', svg)
    svg = re.sub(r'href="#([^"]+)"', lambda m: f'href="#{prefix}-{m.group(1)}"', svg)

    # matplotlib writes its whole fallback list into every label; the page
    # has the site's own stacks from tokens.css, so use those.
    svg = re.sub(r"font-family: ([^;\"]+)", _site_stack, svg)

    # The root carries a class for the scoped style and the page's CSS.
    svg = re.sub(r'<svg\b', f'<svg class="chart-svg chart-{prefix}"', svg, count=1)

    # matplotlib's "*{ ... }" rule would apply to the whole page inline.
    svg = re.sub(r'(<style[^>]*>)\s*\*\s*\{', rf'\1.chart-{prefix} *{{', svg)
    return svg.strip() + '\n'


def _logo_reference(match: re.Match) -> str:
    """One logo's <image>: its embedded picture replaced by "logo:<TEAM>".

    matplotlib stores an embedded picture upside down and turns it right
    way up with transform="scale(1 -1) translate(0 -h)". The logo file the
    site serves is the right way up, so that flip has to go too, or every
    logo shows upside down. With the flip, an image at y is drawn with its
    top edge at -y; without it, it is simply placed there.
    """
    group, team, tag = match.groups()
    tag = re.sub(r'xlink:href="data:image/[^"]+"', f'xlink:href="logo:{team}"', tag)
    flip = re.search(r'\s+transform="scale\(1 -1\) translate\(0 -([\d.]+)\)"', tag)
    y = re.search(r'\by="(-?[\d.]+)"', tag)
    if flip and y:
        tag = tag.replace(flip.group(0), '')
        tag = tag.replace(y.group(0), f'y="{_number(-float(y.group(1)))}"')
    return group + tag


def _number(value: float) -> str:
    """A coordinate as matplotlib writes it: no trailing .0, no -0."""
    text = f'{value:.6f}'.rstrip('0').rstrip('.')
    return '0' if text in ('-0', '') else text


def _site_stack(match: re.Match) -> str:
    family = first_family(match.group(1))
    if family == FONT_HEADING:
        return f"font-family: {TOKENS['font-heading']}"
    if family == FONT_BODY:
        return f"font-family: {TOKENS['font-body']}"
    return match.group(0)


def save(fig, slug: str, directory: Path = CONTENT_DIR) -> Path:
    """Write the figure to <directory>/<slug>.svg, only if it changed."""
    import matplotlib.pyplot as plt

    path = directory / f'{slug}.svg'
    text = svg_text(fig, slug)
    plt.close(fig)
    if not path.exists() or path.read_text() != text:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        shown = path.relative_to(ROOT) if path.is_relative_to(ROOT) else path
        print(f'{shown}: updated')
    return path
