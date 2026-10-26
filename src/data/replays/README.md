# Retro Replays data

Famous plays redrawn as pixel art from player tracking. This folder holds the
data the pages read at build time: `plays/<key>.json`, one scene per replay, and
`index.json`, every play in the Next Gen Stats highlights collection (facts
only) to pick replays from. `pipelines/replays.py` writes both; its docstring
has every rule in the order it runs.

## Pipeline

```
python pipelines/replays.py KEY [KEY ...]      build scenes for these plays
python pipelines/replays.py --index            rewrite index.json
python pipelines/replays.py --fetch-all --index  fill the tracking cache first (about 1.3 GB)
```

- A key is `season_team_gameId_playId`, a file name in
  [asonty/ngs_highlights](https://github.com/asonty/ngs_highlights) `play_data/`,
  read at a pinned commit (`NGS_SHA`). The team is whose highlight it is, not
  always the team that snapped.
- Tracking files are cached in `pipelines/.cache/ngs/` (`NGS_CACHE_DIR` to point
  elsewhere), play-by-play through `pbp_cache.py` (`PBP_CACHE_DIR`). Both are
  gitignored.
- Play facts (description, date, teams, score after, win probability, penalty)
  are nflverse's, matched on `old_game_id` and `play_id`. Win probability is
  nflfastR's model.
- Pick plays on the dev-only catalog, `/replays/dev/catalog/` under `npm run dev`
  (never in a build), and copy their keys.

## The rules in brief

- **Featured team.** A scene follows the team whose win probability rose on the
  play, so its swing is always a gain and a return or pick-six is seen from the
  team that made it. With no change, the receiving team on a kick, else the team
  that snapped. The featured team moves left to right; `field.attack` says which
  way the team that snapped moves (1 right, -1 left).
- **Window.** 1.5 s before the snap (or the kick) to 1.5 s after the first
  terminal event. With none, 1 s after the carrier slows under 1 yd/s following
  first contact; failing that, the end of the file.
- **Carrier.** The quarterback (the punter on a punt) from the snap to a handoff,
  pass, lateral or fumble; nobody while the ball is in the air; the first player
  to have it after a flight or a handoff, at once; otherwise the player nearest
  the ball within 2 yards, changing only after 3 frames in a row.
- **Flights** (the ball in the air): passes and kicks from their events; laterals
  and direct snaps from the toss to the first frame the ball is within 1 yard of
  someone else, since NGS has no event for their catch.

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
top speed in mph, from NGS's `s`) and `airYards`, from the tracking file when it
was cached.

## Known data issues

- 21 tracking files repeat the play: two snaps, the second copy's events offset
  and some mislabelled. The catalog flags them and gives them no numbers; no
  rule picks the right copy for all of them, so a pick among them needs its
  window set by hand.
- Direct snaps are `snap_direct` in NGS, not `ball_snap`.
- Tracking can jump: a runner going out of bounds can leap yards in a frame
  (Lindsay, `2018_DEN_2018112509_1576`, frame 79).
- nflverse names moved teams by today's abbreviation in some seasons (the 2018
  Raiders are `LV` there, `OAK` in NGS); scenes keep NGS's and match by
  franchise.
