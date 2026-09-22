/**
 * Makes a chart readable point by point: a thin guide line and a dot at
 * the point nearest the pointer, and a boxed readout of its lines. Mouse
 * hover, touch drag (when the chart is not scrolling sideways), and arrow
 * keys, Home and End once the chart has focus. Each readout is announced
 * to screen readers. Nothing moves on its own and nothing animates.
 *
 * A chart takes part when its figure has [data-chart-hover] and holds a
 * <script type="application/json" data-chart-hover-data> (ChartFigure).
 */
import { nearestIndex, stepIndex, toSvg, type ChartHover } from './hover';

export function initChartHover(): void {
  for (const figure of document.querySelectorAll<HTMLElement>('[data-chart-hover]')) {
    const data = figure.querySelector('script[data-chart-hover-data]');
    const frame = figure.querySelector<HTMLElement>('.frame');
    const svg = frame?.querySelector('svg');
    if (!data || !frame || !svg || figure.dataset.hoverReady) continue;
    figure.dataset.hoverReady = 'true';
    try {
      attach(frame, svg, JSON.parse(data.textContent ?? '') as ChartHover, figure);
    } catch {
      // A chart without readable hover data is still a chart.
    }
  }
}

function attach(frame: HTMLElement, svg: SVGSVGElement, hover: ChartHover, figure: HTMLElement): void {
  const view = svg.viewBox.baseVal;
  const layer = document.createElement('div');
  layer.className = 'hover-layer';
  layer.setAttribute('aria-hidden', 'true');
  const guide = document.createElement('div');
  guide.className = 'hover-guide';
  const dot = document.createElement('div');
  dot.className = 'hover-dot';
  const readout = document.createElement('div');
  readout.className = 'hover-readout';
  layer.append(guide, dot, readout);
  frame.append(layer);

  const live = document.createElement('p');
  live.className = 'visually-hidden';
  live.setAttribute('aria-live', 'polite');
  figure.append(live);

  let current = -1;

  // viewBox units to CSS pixels within the frame (which may be scrolled).
  function scale() {
    const box = svg.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    return {
      k: box.width / view.width,
      left: box.left - frameBox.left + frame.scrollLeft,
      top: box.top - frameBox.top + frame.scrollTop,
    };
  }

  function show(index: number) {
    if (index < 0 || index >= hover.points.length) return;
    current = index;
    const point = hover.points[index]!;
    const at = toSvg(hover, point);
    const { k, left, top } = scale();
    const x = left + at.x * k;

    layer.hidden = false;
    guide.hidden = hover.mode !== 'x';
    guide.style.left = `${x}px`;
    guide.style.top = `${top + hover.plot.y * k}px`;
    guide.style.height = `${hover.plot.height * k}px`;

    dot.hidden = at.y === null;
    if (at.y !== null) {
      dot.style.left = `${x}px`;
      dot.style.top = `${top + at.y * k}px`;
    }

    readout.replaceChildren(
      ...point.lines.map((line, i) => {
        const el = document.createElement(i === 0 ? 'strong' : 'span');
        el.textContent = line;
        return el;
      })
    );
    // Beside the point, on whichever side has room; near the top of the
    // plot, or by the point for a scatter.
    const plotLeft = left + hover.plot.x * k;
    const plotRight = plotLeft + hover.plot.width * k;
    const width = readout.offsetWidth;
    const onRight = x + 12 + width <= plotRight || x - 12 - width < plotLeft;
    readout.style.left = `${onRight ? x + 12 : x - 12 - width}px`;
    const anchorY = at.y === null ? top + hover.plot.y * k + 8 : top + at.y * k - readout.offsetHeight / 2;
    const minY = top + hover.plot.y * k;
    const maxY = minY + hover.plot.height * k - readout.offsetHeight;
    readout.style.top = `${Math.max(minY, Math.min(maxY, anchorY))}px`;

    live.textContent = point.lines.join('. ');
  }

  function hide() {
    layer.hidden = true;
  }

  function fromPointer(event: PointerEvent) {
    const box = svg.getBoundingClientRect();
    const k = box.width / view.width;
    show(nearestIndex(hover, (event.clientX - box.left) / k, (event.clientY - box.top) / k));
  }

  // Touch: a drag reads the chart, unless the frame has to scroll sideways
  // on a narrow screen, where a drag must still scroll it (a tap reads).
  function touchMode() {
    frame.style.touchAction = frame.scrollWidth > frame.clientWidth ? '' : 'pan-y';
  }
  touchMode();
  new ResizeObserver(touchMode).observe(frame);

  svg.addEventListener('pointermove', fromPointer);
  svg.addEventListener('pointerdown', fromPointer);
  frame.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse' && document.activeElement !== frame) hide();
  });

  frame.addEventListener('focus', () => show(current < 0 ? 0 : current));
  frame.addEventListener('blur', hide);
  frame.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hide();
      return;
    }
    const next = stepIndex(event.key, current, hover.points.length);
    if (next === null) return;
    event.preventDefault();
    show(next);
  });

  hide();
}
