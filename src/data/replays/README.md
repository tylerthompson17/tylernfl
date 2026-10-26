# Retro Replays data

Famous plays redrawn as pixel art from player tracking: a replay for every play
in the Next Gen Stats highlights collection that passes its checks (517 of 559),
with Tyler's picks featured. `pipelines/replays.py` makes all of it; its
docstring has every rule in the order it runs.

## What is committed and what is generated

- **Committed:** `featured.json` (the featured keys, in display order) and this README.
- **Generated, gitignored:** `plays/<key>.json` (one scene per replay),
  `index.json` (every play in the collection, facts only) and `validation.json`
  (what was built and why plays were left out). The deploy makes them; make them
  locally with `--all` below. Pages read them only if present, so a checkout
  without them builds, with empty states.

## Pipeline

```
python pipelines/replays.py --all                everything: index, scenes, checks, report
python pipelines/replays.py --report             print validation.json again
python pipelines/replays.py KEY [KEY ...]        build these scenes only (no checks)
python pipelines/replays.py --fetch-all --index  download the tracking files, then the index
```

- A key is `season_team_gameId_playId`, a file name in
  [asonty/ngs_highlights](https://github.com/asonty/ngs_highlights) `play_data/`,
  read at a pinned commit (`NGS_SHA`). The team is whose highlight it is, not
  always the team that snapped.
- Tracking files are cached in `pipelines/.cache/ngs/` (about 1.3 GB;
  `NGS_CACHE_DIR` to point elsewhere), play-by-play through `pbp_cache.py`
  (`PBP_CACHE_DIR`). Both are gitignored. `--all` takes about 45 s.
- Play facts (description, date, teams, score after, win probability, penalty)
  are nflverse's, matched on `old_game_id` and `play_id`. Win probability is
  nflfastR's model.

## In the deploy

`.github/workflows/deploy.yml`, build job, before the Astro build: restore the
play-by-play cache (the daily job's; a miss downloads), restore the generated
replays if no input changed (the key hashes `replays.py`, its helpers, team
colors, `featured.json`, the 2017 to 2019 play-by-play and `NGS_SHA`),
otherwise restore or shallow-fetch the tracking files at `NGS_SHA`, run `--all`
and cache the output. The report goes to the job summary. Pull requests run the
same build without deploying.

## Featured

Pick plays on the dev-only catalog (`/replays/dev/catalog/` under `npm run dev`,
never in a build), copy their keys into `featured.json`, run `--all`. Every
featured play must pass its checks: `tests/replays-featured.test.ts` fails when
one does not (it skips without generated data), and so does the pull request
build. On a deploy a failing featured play is left out of Featured with a
warning in the job summary rather than failing the deploy.

## Checks

A play gets no replay (`check_scene`) when, between the snap or kick and the
play's terminal event:

- nobody holds the ball for over 1.5 s while it is live. In the air, loose
  after a fumble, muff or landed kick until an event says who has it, and dead
  after an incompletion do not count;
- the ball goes over 5 yards off the field;
- a player moves faster than 25.6 mph (12.5 yd/s) from one frame to the next;

or when the tracking file repeats the play (two snaps) or nflverse has no
matching play. Duplicate keys for one play are built once. As of the first run:
21 repeats, 18 implausible speeds, 2 carrier gaps, 1 missing play-by-play.

## The rules in brief

- **Featured team.** A scene follows the team whose win probability rose on the
  play, so its swing is always a gain and a return or pick-six is seen from the
  team that made it. With no change, the receiving team on a kick, else the team
  that snapped. The featured team moves left to right; `field.attack` says which
  way the team that snapped moves (1 right, -1 left).
- **Window.** 1.5 s before the snap (or the kick) to 1.5 s after the first
  terminal event (a touchdown pass counts). With none, 1 s after the carrier
  slows under 1 yd/s following first contact; failing that, the last frame with
  players tracked.
- **Carrier.** The quarterback (the punter on a punt) from the snap to a
  handoff, pass, lateral or fumble. Nobody while the ball is in the air, loose or
  dead. When a flight or loose ball ends, the first player of the team that gets
  it (a catch: the passing team; an interception or return: the other) within 2
  yards takes it at once; after a handoff, the first new player near it. Then it
  stays with that player until an event moves it: tacklers piling on never take
  it. From the play's end it stays as it was.
- **Flights** (the ball in the air): passes and kicks from their events; laterals
  and direct snaps from the toss to the first frame the ball is within 1 yard of
  someone else, since NGS has no event for their catch.
- **Glitches.** After the play, a player whose track jumps faster than 25.6 mph
  in a frame (tracks reset as players leave) is hidden from then on.

## Scene format (version 2)

Positions are tenths of a yard (`scale` 10) on the 120 by 53.3 field, end zones
included; angles whole degrees clockwise from +y. Speed is not stored: the
renderer works it out from positions.

| Field | What it is |
|---|---|
| `version`, `key`, `source` | Format version, play key, where the tracking came from (`ngs`) |
| `hz`, `scale`, `frameCount` | Frames a second, position scale, number of frames |
| `play` | Facts: season, week, quarter, `clock` at the snap, `down`, `yardsToGo`, `yardline`, `scoreBefore`, `scoreAfter`, `description`, `date`, `wpBefore`/`wpAfter` (the featured team's), `type`, `featured`, `opponent`, `possession` (the team that snapped), `home`, `away`, `kicking`, `penalty` |
| `field` | `lineOfScrimmage`, `firstDown` (null on kicks), `attack` |
| `teams` | `featured` and `opponent`: `abbr`, `primary`, `secondary` |
| `events` | `{frame, name}`, NGS's event names |
| `flights` | `{kind, from, to}`: `pass`, `kick`, `punt`, `lateral` or `snap` |
| `ball` | **Required.** `x`, `y` per frame; optional `z`, height |
| `carrier` | Optional. Index into `players` per frame, or null |
| `players` | Optional. `id`, `side` (`featured` or `opponent`), `jersey`, `position`, `name`, and per frame `x`, `y`, `dir`, `o` (null where untracked); optional `state` |

The ball's path is the one required track, so later sources fit the same format:

- **Play-by-play only** (schematic replays): `ball` and `flights`, no `players`
  or `carrier`. The camera follows the ball.
- **Video-derived tracking:** the same fields, with `source` naming it. Add
  `ball.z` to replace the drawn arc (gravity 10.7 yd/s², leaving a pass at 2
  yards, a kickoff at 0, a punt at 1), and per player `state` (an action per
  frame, such as diving or tackled) when the renderer learns to draw it.
  Unknown fields are ignored.

`index.json` lines carry the same facts plus `snaps`, `topSpeed` (the carrier's
top speed in mph, from NGS's `s`) and `airYards`.

## Known data issues

- 21 tracking files repeat the play: two snaps, the second copy's events offset
  and some mislabelled. They get no replay.
- Direct snaps are `snap_direct` in NGS, not `ball_snap`; touchdown passes end
  on `pass_outcome_touchdown`, not `touchdown`.
- Some files end with frames of the ball alone; they are dropped.
- nflverse names moved teams by today's abbreviation in some seasons (the 2018
  Raiders are `LV` there, `OAK` in NGS); scenes keep NGS's and match by
  franchise.
