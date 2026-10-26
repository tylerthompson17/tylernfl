/**
 * Retro Replays player sprites: original pixel art, drawn here as text
 * templates and recolored per team. Upright 3/4 view, 13 pixels wide by 21
 * tall, anchored at the feet (the bottom row's middle). Five drawings
 * (away from the camera, away-right, right, toward-right, toward the
 * camera) cover all eight facings: the three left ones are mirrors.
 *
 * Template letters, each a palette slot:
 *   o outline   h helmet    s helmet stripe   v visor   m face mask
 *   j jersey    t collar    n number          g glove   p pants
 *   k sock      b shoe      . clear
 */

export const SPRITE_W = 13;
export const SPRITE_H = 21;

export type Base = 'U' | 'UR' | 'R' | 'DR' | 'D';
export type Slot = 'o' | 'h' | 's' | 'v' | 'm' | 'j' | 't' | 'n' | 'g' | 'p' | 'k' | 'b';
export type Palette = Record<Slot, string>;

const UPPER: Record<Base, string[]> = {
  D: [
    '....ooooo....',
    '...ohhshho...',
    '..ohhhshhho..',
    '..ohvvvvvho..',
    '..ohmmmmmho..',
    '...ohmmmho...',
    '.ooojjtjjooo.',
    'ojjjjjjjjjjjo',
    'ojjjjjjjjjjjo',
    'ojojjnnnjjojo',
    'ojojjnjnjjojo',
    'ojojjjjjjjojo',
    'ogojjjjjjjogo',
    '.oopppppppoo.',
  ],
  DR: [
    '....ooooo....',
    '...ohhhsho...',
    '..ohhhhhsho..',
    '..ohhhvvvvo..',
    '..ohhhmmmmo..',
    '...ohhhmmo...',
    '.ooojjjtjooo.',
    'ojjjjjjjjjjjo',
    'ojjjjjjjjjjjo',
    'ojojjjjnnjojo',
    'ojojjjjnnjojo',
    'ojojjjjjjjojo',
    'ogojjjjjjjogo',
    '.oopppppppoo.',
  ],
  R: [
    '....oooo.....',
    '...osssso....',
    '..ohhhhhho...',
    '..ohhhhvvo...',
    '..ohhhhmmmo..',
    '...ohhhho....',
    '...oojjjoo...',
    '..ojjjjjjjo..',
    '..ojjnnjjjo..',
    '..ojjnojjjo..',
    '..ojjjojjjo..',
    '..ojjjogjjo..',
    '..ojjjjoojo..',
    '..oopppppoo..',
  ],
  UR: [
    '....ooooo....',
    '...ohshhho...',
    '..ohshhhhho..',
    '..ohshhhhho..',
    '..ohhhhhhvo..',
    '...ohhhhho...',
    '.ooojjjjjooo.',
    'ojjjjjjjjjjjo',
    'ojnnjjjjjjjjo',
    'ojonjjjjjjojo',
    'ojojjjjjjjojo',
    'ojojjjjjjjojo',
    'ogojjjjjjjogo',
    '.oopppppppoo.',
  ],
  U: [
    '....ooooo....',
    '...ohhshho...',
    '..ohhhshhho..',
    '..ohhhshhho..',
    '..ohhhshhho..',
    '...ohhhhho...',
    '.ooojjjjjooo.',
    'ojjjjjjjjjjjo',
    'ojjjjnnnjjjjo',
    'ojojjnjnjjojo',
    'ojojjnnnjjojo',
    'ojojjjjjjjojo',
    'ogojjjjjjjogo',
    '.oopppppppoo.',
  ],
};

const LEGS = {
  frontStand: [
    '..opppppppo..',
    '..opppopppo..',
    '..opppopppo..',
    '..okkkokkko..',
    '..okkkokkko..',
    '..obbbobbbo..',
    '..ooooooooo..',
  ],
  frontStep: [
    '..opppppppo..',
    '..opppopppo..',
    '..okkkopppo..',
    '..obbbopppo..',
    '..oooookkko..',
    '......obbbo..',
    '......ooooo..',
  ],
  sideStand: [
    '...oppppo....',
    '...oppppo....',
    '...oppppo....',
    '...okkkko....',
    '...okkkko....',
    '...obbbbbo...',
    '...ooooooo...',
  ],
  sideStride: [
    '...oppppo....',
    '..opppoppo...',
    '.oppo.oppo...',
    '.okko..okko..',
    'okko....okko.',
    'obbo....obbbo',
    'ooo.....ooooo',
  ],
  sidePass: [
    '...oppppo....',
    '...oppppo....',
    '...opppppo...',
    '...okkoppo...',
    '...okko.okbo.',
    '...obbbo.oo..',
    '...ooooo.....',
  ],
};

const mirrorRow = (row: string) => [...row].reverse().join('');

/** Legs for a drawing and run frame (0 standing, 1 to 4 running). */
function legs(base: Base, frame: number): string[] {
  if (base === 'D' || base === 'U') {
    if (frame === 1) return LEGS.frontStep;
    if (frame === 3) return LEGS.frontStep.map(mirrorRow);
    return LEGS.frontStand;
  }
  if (frame === 0) return LEGS.sideStand;
  return frame % 2 === 1 ? LEGS.sideStride : LEGS.sidePass;
}

/** The template rows for one drawing and run frame. */
export function spriteRows(base: Base, frame: number): string[] {
  return [...UPPER[base], ...legs(base, frame)];
}

/** Octant (0 up the screen, clockwise) to a drawing, mirrored for the left-facing three. */
export function baseFor(octant: number): { base: Base; mirror: boolean } {
  const bases: Base[] = ['U', 'UR', 'R', 'DR', 'D', 'DR', 'R', 'UR'];
  return { base: bases[octant % 8]!, mirror: octant % 8 >= 5 };
}

export const BASES: Base[] = ['U', 'UR', 'R', 'DR', 'D'];
export const RUN_FRAMES = 5;

export interface Neutrals {
  outline: string;
  visor: string;
  mask: string;
  pants: string;
  roadJersey: string;
  shoe: string;
}

/**
 * A team's palette. Helmets are always the team's color; the home team
 * wears its color, the road team white with its color as trim, as in the
 * NFL.
 */
export function teamPalette(team: { primary: string; secondary: string }, home: boolean, n: Neutrals): Palette {
  return {
    o: n.outline,
    h: team.primary,
    s: team.secondary,
    v: n.visor,
    m: n.mask,
    j: home ? team.primary : n.roadJersey,
    t: home ? team.secondary : team.primary,
    n: home ? team.secondary : team.primary,
    g: home ? n.roadJersey : team.primary,
    p: n.pants,
    k: team.primary,
    b: n.shoe,
  };
}

/** Paint template rows at (x, y), the top left corner, optionally mirrored. */
export function paintRows(ctx: CanvasRenderingContext2D, rows: string[], palette: Partial<Record<string, string>>, x: number, y: number, mirror = false): void {
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const color = palette[row[c]!];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + (mirror ? row.length - 1 - c : c), y + r, 1, 1);
    }
  });
}

/**
 * A team's sprite sheet: one row per drawing (BASES order), one column per
 * run frame, each cell SPRITE_W by SPRITE_H, facing right or toward the
 * camera. Mirroring happens when a cell is drawn.
 */
export function buildSheet(palette: Palette): HTMLCanvasElement {
  const sheet = document.createElement('canvas');
  sheet.width = SPRITE_W * RUN_FRAMES;
  sheet.height = SPRITE_H * BASES.length;
  const ctx = sheet.getContext('2d')!;
  BASES.forEach((base, b) => {
    for (let f = 0; f < RUN_FRAMES; f++) paintRows(ctx, spriteRows(base, f), palette, f * SPRITE_W, b * SPRITE_H);
  });
  return sheet;
}

/** Draw one sprite from a sheet with its feet at (x, y). */
export function drawSprite(ctx: CanvasRenderingContext2D, sheet: HTMLCanvasElement, octant: number, frame: number, x: number, y: number): void {
  const { base, mirror } = baseFor(octant);
  const sx = frame * SPRITE_W;
  const sy = BASES.indexOf(base) * SPRITE_H;
  const left = Math.round(x) - Math.floor(SPRITE_W / 2);
  const top = Math.round(y) - SPRITE_H + 1;
  if (!mirror) {
    ctx.drawImage(sheet, sx, sy, SPRITE_W, SPRITE_H, left, top, SPRITE_W, SPRITE_H);
    return;
  }
  ctx.save();
  ctx.translate(left + SPRITE_W, top);
  ctx.scale(-1, 1);
  ctx.drawImage(sheet, sx, sy, SPRITE_W, SPRITE_H, 0, 0, SPRITE_W, SPRITE_H);
  ctx.restore();
}

/** Small ground marks, in the same template letters as the sprites. */
export const SHADOW = ['.#######.', '#########', '.#######.'];
export const RING = ['...#########...', '.##.........##.', '#.............#', '.##.........##.', '...#########...'];
export const BALL = ['.ooo.', 'obwbo', '.ooo.'];
export const BALL_SHADOW = ['.###.', '#####'];
