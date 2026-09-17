# ESPN scoreboard fixtures

Real responses from ESPN's public NFL scoreboard, used by `tests/live-ticker/` to test the live ticker's parsing. These are test data only: ESPN data is never written to `src/data/` or used by the pipelines.

| File | What it is |
|---|---|
| `scoreboard-2026-week1-final.json` | Week 1 after every game was final, including an overtime game (NO at DET). Trimmed to the fields the ticker reads. |
| `scoreboard-2026-week2-scheduled.json` | Week 2 before any kickoff. Trimmed the same way. |
| `scoreboard-2026-week2-in-progress.json` | Full, untrimmed response captured during DET at BUF (2026-09-17). Written by `.github/workflows/capture-espn-fixture.yml`. |
| `event-401872932-<status>-q<quarter>.json` | The DET at BUF event once per status seen during that game (in progress by quarter, halftime, end of quarter, final). |

The in-progress files do not exist until the Thursday capture runs. Until then, in-progress parsing in `src/lib/live-ticker/espn.ts` is provisional and tested only against synthetic statuses.
