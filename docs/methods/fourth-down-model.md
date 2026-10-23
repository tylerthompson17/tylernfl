# The 4th down calculator's model: nfl4th, ported

The calculator at `/fourth-down/` shows Ben Baldwin's [nfl4th](https://github.com/nflverse/nfl4th)
numbers, reproduced exactly. This note says what was ported, how it runs on the site, how it
was checked, and what it does not do. It is not this site's model and is not adjusted for teams.

## What was ported

nfl4th at commit `ecb7293`: its 4th down decision (go, field goal, punt) and its try after a
touchdown (`add_2pt_probs()`: extra point or go for 2), with the trained models it uses:

- nfl4th's conversion model (yards gained on a 4th down attempt, 76 classes from -10 to 65),
  its home win probability model and its 2-point conversion model;
- nflfastR's expected points model and spread-adjusted win probability model (fastrmodels
  2.1.0), which nfl4th averages with its own win probability;
- nfl4th's field goal make probabilities by spot and its punt outcome table.

The port was built in two steps in the fourth-down repository:

1. A Python port of nfl4th's R code, quirks included (each function names its R twin), which
   matched nfl4th's R output on every 4th down (49,416) and every try (16,702) from 2014 to 2025.
2. A TypeScript engine (`src/lib/fourth-down-engine.ts`, generated there, not edited here) that
   evaluates the same XGBoost trees and tables from exported JSON (`models/fourth-down/`). It
   reproduces XGBoost's float32 arithmetic tree by tree; the only known difference is the final
   link function, where JavaScript has no float32 `exp` and can land one float32 step (about
   3e-8) away.

## Agreement check

`scripts/export_model.py` in fourth-down writes 3,907 fixture situations with the Python port's
results: 2,979 4th downs (every yard line and distance on a grid, plus 1,500 real plays from 2018
to 2022, overtime and endgame cases) and 928 tries. `tests/fourth-down-engine.test.ts` runs every
one through the engine:

- calls, null options, flags, reasons and kick distance must match exactly;
- every probability must be within 1e-6.

All 3,907 pass. The largest difference in any probability is 6.0e-8 (a field goal's win
probability if missed); the next largest are about 4e-8.
`npm test` runs a fixed sample of 400; `npm run test:fourth-down-engine` runs all of them.

`tests/calculator.test.ts` also sends a set of fixtures through the page's own path (form values,
query string, back to a form, situation, `recommend()` or `recommendTry()`) and checks the result
against the fixture, so the page's conversions are covered too.

## On the site

- The model files are content-hashed build assets, fetched only by the calculator, in a Web
  Worker. About 10.6 MB of JSON, 2.6 MB gzipped, most of it the conversion model (6.0 MB, 1.4 MB
  gzipped) and nflfastR's expected points model (3.1 MB, 0.8 MB gzipped).
- One 4th down recommendation takes about 15 ms on a desktop and 50 to 100 ms with the CPU slowed
  4x (a mid-range phone), so it runs in the worker rather than on the main thread. A try takes
  under 1 ms.
- `recommend()` and `recommendTry()` in `src/lib/fourth-down.ts` hand each call to the engine.
  A model built for another contract version, or files that fail to load, give `'unavailable'`
  and the page says the calculator is unavailable.

## Limitations

- Not team-adjusted: apart from the pregame spread and total, every team is alike. The page
  uses two stand-in teams and asks only which side is home.
- The kicker is league average and temperature is not used.
- No overtime, and nothing with 15 seconds or less left in the game: nfl4th does not compute
  those, and the page says so.
- Field goals over 70 yards are left out (nfl4th keeps them with a make chance of 0). Punts are
  left out where nfl4th's punt table has no outcomes, inside the opponent's 31.
- A missing spread is a pick'em; a missing total is the median total of the 2025 season (44.5).
- Seasons before 2014 are not offered: nfl4th's game table starts there.
- Win probability is nfl4th's own: the average of its home win probability model and nflfastR's
  spread model, not nflfastR's published `wp` alone.

## License

nfl4th (Ben Baldwin) and nflfastR / fastrmodels (Sebastian Carl and Ben Baldwin) are MIT
licensed: [nfl4th](https://github.com/nflverse/nfl4th/blob/master/LICENSE),
[nflfastR](https://github.com/nflverse/nflfastR/blob/master/LICENSE).
