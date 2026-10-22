"""Playoff odds: writes src/data/playoff_odds.json by simulating the rest
of the regular season many times and seeding each simulated season with
the same NFL tiebreakers as the standings (standings.py, checked against
nflseedR).

Game probabilities are an input, not something this module decides. It
takes a function from the season's unplayed games to each one's chance of
a home win, and GAME_PROBABILITIES names the one in use. Team ratings are
not built yet; they are a delegated method (CLAUDE.md, Modeling ownership)
and would replace betting_lines, returning the same thing.

The default, betting_lines, reads nflverse's moneylines. Each side's
American odds become an implied probability, and the bookmaker's margin
is taken out by scaling the two to sum to 1; there is nothing to tune.
Lines appear about a week before a game, so every game without one counts
as 50/50. Early in the season that is nearly every game, and the odds
are close to records and schedules alone. The pages say so, naming the
weeks, in the words of oddsBasis() in src/lib/odds/basis.ts: change that
with GAME_PROBABILITIES.

Simulated games never end in a tie (about 0.3% of real games do).
Simulated scores are 1 to 0, which the tiebreakers never read at this
depth: they stop at strength of schedule, before any point totals.

The random draws are seeded from a hash of the inputs, so a rerun with no
new results and no new lines writes an identical file.

The same simulated seasons also project the next draft's round 1
(DraftProjection, at the end): each season's playoffs are played out and
its draft order set from its own records. Those draws come from a second
stream, so this file is byte-identical with or without the projection
(test_playoff_odds.py checks it against output saved before it existed).
"""

import hashlib
import json
import random
from typing import Callable

import draft_order
import standings
from common import normalize_team

SIMULATIONS = 10_000
SOURCE = 'betting lines'


def implied(american: float) -> float:
    """American odds to the probability they imply, margin included."""
    return -american / (-american + 100) if american < 0 else 100 / (american + 100)


def betting_lines(games: list[dict]) -> dict[str, float]:
    """Home win probability for each game from its moneylines, with the
    bookmaker's margin removed; 0.5 for a game with no line yet."""
    probabilities = {}
    for g in games:
        home, away = g.get('home_moneyline'), g.get('away_moneyline')
        if home is None or away is None:
            probabilities[g['game_id']] = 0.5
            continue
        h, a = implied(home), implied(away)
        probabilities[g['game_id']] = h / (h + a)
    return probabilities


def priced(games: list[dict]) -> int:
    """How many games have a line."""
    return sum(1 for g in games if g.get('home_moneyline') is not None and g.get('away_moneyline') is not None)


# The one place to plug in a different source of game probabilities.
GAME_PROBABILITIES: Callable[[list[dict]], dict[str, float]] = betting_lines


def split_season(schedule_rows: list[dict], season: int) -> tuple[list[dict], list[dict]]:
    """(completed, unplayed) regular season games of a season."""
    completed, unplayed = [], []
    for g in schedule_rows:
        if g['season'] != season or g['game_type'] != 'REG':
            continue
        done = g.get('away_score') is not None and g.get('home_score') is not None
        (completed if done else unplayed).append(g)
    return completed, unplayed


def _seed_for(completed: list[dict], probabilities: dict[str, float], n: int) -> int:
    key = json.dumps([
        sorted((g['game_id'], g['away_score'], g['home_score']) for g in completed),
        sorted((k, round(v, 6)) for k, v in probabilities.items()),
        n,
    ])
    return int(hashlib.sha256(key.encode()).hexdigest()[:16], 16)


def simulate(completed: list[dict], unplayed: list[dict], probabilities: dict[str, float],
             alignment: dict[str, tuple[str, str]], n: int = SIMULATIONS,
             draft: 'DraftProjection | None' = None) -> dict[str, dict]:
    """Counts per team over n simulated seasons: playoffs, division, top
    seed, each seed 1 to 7, and total wins (ties in completed games as half).
    With `draft`, each simulated season also goes to draft.record."""
    seed = _seed_for(completed, probabilities, n)
    rng = random.Random(seed)
    if draft:
        draft.start(seed)
    counts = {team: {'playoffs': 0, 'division': 0, 'topSeed': 0, 'seeds': [0] * 7, 'wins': 0.0} for team in alignment}
    for _ in range(n):
        simulated = []
        for g in unplayed:
            home_wins = rng.random() < probabilities.get(g['game_id'], 0.5)
            simulated.append({**g, 'home_score': 1 if home_wins else 0, 'away_score': 0 if home_wins else 1})
        # standings.compute, keeping h2h for the draft order.
        table, h2h = standings.records(completed + simulated, alignment)
        standings.division_ranks(table, h2h)
        standings.conference_ranks(table, h2h)
        if draft:
            draft.record(table, h2h)
        for team, row in table.items():
            c = counts[team]
            c['wins'] += row['wins']
            if row['div_rank'] == 1:
                c['division'] += 1
            if row['conf_rank'] <= 7:
                c['playoffs'] += 1
                c['seeds'][row['conf_rank'] - 1] += 1
            if row['conf_rank'] == 1:
                c['topSeed'] += 1
    return counts


def build_playoff_odds(schedule_rows: list[dict], season: int, updated: str,
                       alignment: dict[str, tuple[str, str]] | None = None,
                       n: int = SIMULATIONS,
                       game_probabilities: Callable[[list[dict]], dict[str, float]] | None = None,
                       draft: 'DraftProjection | None' = None) -> dict:
    """The PlayoffOddsData shape in src/data/types.ts. With `draft`, the
    same simulated seasons also project the draft order (draft.result())."""
    alignment = alignment or standings.load_alignment()
    completed, unplayed = split_season(schedule_rows, season)
    if not completed:
        # Before the first game there is nothing but coin flips to show.
        return {'season': season, 'throughWeek': 0, 'updated': updated, 'simulations': 0,
                'source': SOURCE, 'pricedGames': priced(unplayed), 'remainingGames': len(unplayed), 'teams': []}
    probability_of = game_probabilities or GAME_PROBABILITIES
    probabilities = probability_of(unplayed)
    if draft:
        draft.prepare(schedule_rows, season, probability_of, priced(unplayed), len(unplayed))
    counts = simulate(completed, unplayed, probabilities, alignment, n, draft)
    return {
        'season': season,
        'throughWeek': max((g['week'] for g in completed), default=0),
        'updated': updated,
        'simulations': n,
        'source': SOURCE,
        'pricedGames': priced(unplayed),
        'remainingGames': len(unplayed),
        'teams': [
            {
                'team': team,
                'playoffs': round(c['playoffs'] / n, 3),
                'division': round(c['division'] / n, 3),
                'topSeed': round(c['topSeed'] / n, 3),
                'seeds': [round(s / n, 3) for s in c['seeds']],
                'meanWins': round(c['wins'] / n, 1),
            }
            for team, c in sorted(counts.items())
        ],
    }


# ---------------------------------------------------------------- draft projection

PLAYOFF_ROUNDS = ('WC', 'DIV', 'CON', 'SB')


class DraftProjection:
    """Round 1 of the next draft, projected from the same simulated seasons
    as the playoff odds (docs/methods/playoff-simulation.md, Draft order).

    Each simulated season is seeded as the standings seed it (the same
    `standings` ranks the odds count), then the playoffs are played: the
    higher seed at home, a played playoff game kept as it finished, every
    other one a home win with the chance GAME_PROBABILITIES gives it. A
    matchup with no betting line, which is every one until the real games
    are set in January, is even. Then the draft order (draft_order.order)
    from that season's own records, strength of schedule and tiebreakers,
    with any tie left drawn at random, and the picks file applied.

    Its draws come from a second random stream, seeded from the odds' seed,
    so the odds draw exactly what they drew before and playoff_odds.json is
    unchanged by it."""

    def __init__(self, picks: dict, teams: list[str]):
        self.picks = picks
        self.teams = sorted(teams)
        self.slots = {t: [0] * len(self.teams) for t in self.teams}
        self.choice_counts = [{t: 0 for t in c['between']} for c in picks['choices']]
        self.n = 0

    def prepare(self, schedule_rows: list[dict], season: int,
                probability_of: Callable[[list[dict]], dict[str, float]], priced_games: int, remaining: int) -> None:
        self.season = season
        self.probability_of = probability_of
        self.priced_games, self.remaining = priced_games, remaining
        self.real = {}
        for g in schedule_rows:
            if g['season'] == season and g['game_type'] in PLAYOFF_ROUNDS:
                pair = frozenset((normalize_team(g['away_team']), normalize_team(g['home_team'])))
                self.real[(g['game_type'], pair)] = g
        self.priced_playoff_games = priced([g for g in self.real.values() if g.get('home_score') is None])
        self.chances = {}

    def start(self, seed: int) -> None:
        self.rng = random.Random(int(hashlib.sha256(f'draft {seed}'.encode()).hexdigest()[:16], 16))

    def _chance(self, kind: str, home: str, away: str) -> float:
        """Home win chance for a playoff matchup, worked out once."""
        key = (kind, home, away)
        if key not in self.chances:
            real = self.real.get((kind, frozenset((home, away))))
            game = real or {'game_id': f'{self.season}_{kind}_{away}_{home}', 'season': self.season,
                            'game_type': kind, 'away_team': away, 'home_team': home,
                            'away_moneyline': None, 'home_moneyline': None}
            p = self.probability_of([game]).get(game['game_id'], 0.5)
            self.chances[key] = p if normalize_team(game['home_team']) == home else 1 - p
        return self.chances[key]

    def _winner(self, kind: str, home: str, away: str) -> tuple[str, str]:
        real = self.real.get((kind, frozenset((home, away))))
        if real and real.get('home_score') is not None and real.get('away_score') is not None:
            real_home = normalize_team(real['home_team'])
            home_won = (real['home_score'] > real['away_score']) == (real_home == home)
        else:
            home_won = self.rng.random() < self._chance(kind, home, away)
        return (home, away) if home_won else (away, home)

    def bracket(self, table: dict) -> dict[str, str]:
        """The draft group of every playoff team (draft_order's names) after
        one simulated postseason."""
        exits, champions = {}, []
        for conf in ('AFC', 'NFC'):
            seeds = sorted((r for r in table.values() if r['conf'] == conf and r['conf_rank'] <= 7),
                           key=lambda r: r['conf_rank'])
            rank = {r['team']: r['conf_rank'] for r in seeds}
            alive = [seeds[0]['team']]
            for high, low in ((1, 6), (2, 5), (3, 4)):
                won, lost = self._winner('WC', seeds[high]['team'], seeds[low]['team'])
                exits[lost] = 'wild_card'
                alive.append(won)
            alive.sort(key=rank.get)
            # The top seed hosts the lowest left, the other two meet.
            next_round = []
            for home, away in ((alive[0], alive[3]), (alive[1], alive[2])):
                won, lost = self._winner('DIV', home, away)
                exits[lost] = 'divisional'
                next_round.append(won)
            home, away = sorted(next_round, key=rank.get)
            won, lost = self._winner('CON', home, away)
            exits[lost] = 'conference'
            champions.append(won)
        # A neutral site: the AFC side stands in as home for the lookup.
        won, lost = self._winner('SB', champions[0], champions[1])
        exits[lost], exits[won] = 'super_bowl', 'champion'
        return exits

    def record(self, table: dict, h2h: dict) -> None:
        exits = self.bracket(table)
        keys = {t: self.rng.random() for t in self.teams}
        placed = draft_order.order(table, h2h, exits, toss_key=lambda r: keys[r['team']])
        slots = draft_order.apply_picks([p['team'] for p in placed], self.picks)
        self.pick_count = len(slots)
        for i, slot in enumerate(slots):
            self.slots[slot['team']][i] += 1
        for c, counts in zip(self.picks['choices'], self.choice_counts):
            for slot in slots:
                if slot['team'] in counts and slot['owner'] == c['to']:
                    counts[slot['team']] += 1
        self.n += 1

    def result(self, odds: dict) -> dict | None:
        """The projected part of draft_order.json; None when nothing was
        simulated."""
        n = self.n
        if not n:
            return None
        mean_wins = {t['team']: t['meanWins'] for t in odds['teams']}
        owners = {p['original']: p.get('owner') for p in self.picks['picks']}
        decided_by_choice = {t for c in self.picks['choices'] for t in c['between']}

        def first_reaching(counts: list[int], share: float) -> int:
            total, running = sum(counts), 0
            for pick, count in enumerate(counts, 1):
                running += count
                if running >= share * total:
                    return pick
            return len(counts)

        teams = []
        for team in self.teams:
            counts = self.slots[team]
            if not sum(counts):
                continue  # forfeited
            mean_pick = sum(pick * c for pick, c in enumerate(counts, 1)) / n
            teams.append({
                'team': team,
                'owner': None if team in decided_by_choice else owners.get(team, team),
                'meanWins': mean_wins[team],
                'meanPick': round(mean_pick, 1),
                'medianPick': first_reaching(counts, 0.5),
                'first': round(counts[0] / n, 3),
                'top3': round(sum(counts[:3]) / n, 3),
                'top5': round(sum(counts[:5]) / n, 3),
                'top10': round(sum(counts[:10]) / n, 3),
                'range': [first_reaching(counts, 0.1), first_reaching(counts, 0.9)],
                # Chance of each pick, 1 to 32 (31 with a pick forfeited).
                'slots': [round(c / n, 3) for c in counts[:self.pick_count]],
            })
        teams.sort(key=lambda t: (t['medianPick'], t['meanPick'], t['team']))
        return {
            'simulations': n,
            'source': SOURCE,
            'pricedGames': self.priced_games,
            'remainingGames': self.remaining,
            'pricedPlayoffGames': self.priced_playoff_games,
            'teams': teams,
            'choices': [
                {'between': c['between'], 'takes': c['takes'], 'to': c['to'],
                 'chances': {t: round(count / n, 3) for t, count in counts.items()}}
                for c, counts in zip(self.picks['choices'], self.choice_counts)
            ],
        }
