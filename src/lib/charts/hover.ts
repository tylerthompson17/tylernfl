/**
 * Reading a chart point by point: where each point sits in the SVG, and
 * which point is nearest the pointer. Pure, so it runs under Node's test
 * runner; hover-dom.ts wires it to the page.
 *
 * The data comes from the pipeline (style.save's hover, written as
 * <slug>.hover.json): the plot area in the SVG's viewBox units, the data
 * range along its edges, and the points with the lines to show.
 */

export interface HoverPoint {
  x: number;
  /** Null for a point that marks a place along x without a single value */
  y: number | null;
  /** The first is the headline */
  lines: string[];
}

export interface ChartHover {
  plot: { x: number; y: number; width: number; height: number };
  /** Data at the left and right edges of the plot */
  xRange: [number, number];
  /** Data at the bottom and top edges (reversed for an inverted axis) */
  yRange: [number, number];
  /** "x": nearest along x, for lines over time; "nearest": nearest in both, for scatters */
  mode: 'x' | 'nearest';
  points: HoverPoint[];
}

/** A point's position in the SVG's viewBox units. */
export function toSvg(h: ChartHover, point: HoverPoint): { x: number; y: number | null } {
  const [x0, x1] = h.xRange;
  const [y0, y1] = h.yRange;
  return {
    x: h.plot.x + ((point.x - x0) / (x1 - x0)) * h.plot.width,
    y: point.y === null ? null : h.plot.y + h.plot.height - ((point.y - y0) / (y1 - y0)) * h.plot.height,
  };
}

/**
 * The point nearest a position in viewBox units. Along x, several points
 * can share a place (plays at the same second); the last of them wins, the
 * state once they are all done. The arrow keys still reach each one.
 */
export function nearestIndex(h: ChartHover, svgX: number, svgY: number): number {
  let best = -1;
  let bestDistance = Infinity;
  h.points.forEach((point, i) => {
    const at = toSvg(h, point);
    const distance =
      h.mode === 'nearest' && at.y !== null ? Math.hypot(at.x - svgX, at.y - svgY) : Math.abs(at.x - svgX);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = i;
    }
  });
  return best;
}

/** The next point for an arrow key, Home or End; null for any other key. */
export function stepIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return current < 0 ? 0 : Math.min(count - 1, current + 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return current < 0 ? count - 1 : Math.max(0, current - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
