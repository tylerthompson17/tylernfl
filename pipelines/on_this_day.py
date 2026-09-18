"""Build src/data/on_this_day.json: notable NFL games played on today's date.

Every item is a game from nflverse schedules (1999 on) and every word of it
comes from that game's row: teams, score, round, overtime, the closing
spread, the game-time temperature. Nothing is written by hand, so the
feature only covers games, and only since 1999.

A game is notable when it has at least one of these, scored so the biggest
stories win: a playoff round (the Super Bowl most of all), an upset of 7 or
more points by the spread, a tie, overtime, a shutout, a margin of 30 or
more, 70 or more combined points, or 15 degrees or colder outdoors. Up to
MAX_ITEMS are shown, one per season, newest first.
"""

from datetime import date

from common import normalize_team

MAX_ITEMS = 3
UPSET_POINTS = 7
BLOWOUT_MARGIN = 30
SHOOTOUT_TOTAL = 70
COLD_TEMP = 15
OUTDOOR_ROOFS = {'outdoors', 'open'}

ROUNDS = {'WC': 'the wild card round', 'DIV': 'the divisional round'}
ROUND_WEIGHT = {'SB': 100, 'CON': 60, 'DIV': 45, 'WC': 35}

# Relocated franchises link to today's team page.
FRANCHISE = {'OAK': 'LV', 'SD': 'LAC', 'STL': 'LAR', 'LA': 'LAR'}

SCHEDULE_COLUMNS = [
    'game_id', 'season', 'game_type', 'gameday', 'away_team', 'away_score', 'home_team',
    'home_score', 'overtime', 'spread_line', 'roof', 'temp',
]


def roman(n: int) -> str:
    numerals = [(1000, 'M'), (900, 'CM'), (500, 'D'), (400, 'CD'), (100, 'C'), (90, 'XC'),
                (50, 'L'), (40, 'XL'), (10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')]
    out = ''
    for value, letters in numerals:
        while n >= value:
            out += letters
            n -= value
    return out


def points(x: float) -> str:
    """7.0 -> "7", 7.5 -> "7.5"."""
    return f'{x:g}'


class Team:
    def __init__(self, abbr: str, nick: str, conf: str | None):
        self.abbr = abbr
        self.nick = nick
        self.conf = conf

    def parts(self, start: bool) -> list[dict]:
        """The team as sentence parts, the name itself a link: "the " + "Bills"."""
        link = {'text': self.nick, 'team': normalize_team(FRANCHISE.get(self.abbr, self.abbr))}
        # Washington has had three names since 1999; the city is right in every season.
        if self.abbr == 'WAS':
            return [{**link, 'text': 'Washington'}]
        return [{'text': 'The ' if start else 'the '}, link]


def team_table(rows: list[dict]) -> dict[str, Team]:
    return {r['team_abbr']: Team(r['team_abbr'], r['team_nick'], r['team_conf']) for r in rows}


def notability(game: dict) -> int:
    score = ROUND_WEIGHT.get(game['game_type'], 0)
    away, home = game['away_score'], game['home_score']
    margin = abs(home - away)
    underdog = underdog_points(game)
    if underdog >= UPSET_POINTS:
        score += round(3 * underdog)
    if away == home:
        score += 40
    if game['overtime'] == 1:
        score += 20
    if min(away, home) == 0 and margin > 0:
        score += 15 + margin // 2
    if margin >= BLOWOUT_MARGIN:
        score += margin
    if away + home >= SHOOTOUT_TOTAL:
        score += away + home - 40
    if is_cold(game):
        score += 30 - game['temp']
    return score


def underdog_points(game: dict) -> float:
    """How many points the winner was getting, 0 if the winner was favored.

    spread_line is the home team's expected margin: positive means the home
    team was favored.
    """
    spread = game['spread_line']
    if spread is None or game['away_score'] == game['home_score']:
        return 0.0
    home_won = game['home_score'] > game['away_score']
    return max(0.0, -spread if home_won else spread)


def is_cold(game: dict) -> bool:
    return game['temp'] is not None and game['temp'] <= COLD_TEMP and game['roof'] in OUTDOOR_ROOFS


def describe(game: dict, teams: dict[str, Team]) -> list[dict]:
    """One sentence as parts, like: The Giants beat the Patriots 17-14 in Super Bowl XLII."""
    away, home = teams[game['away_team']], teams[game['home_team']]
    a, h = game['away_score'], game['home_score']
    if a == h:
        parts = [*away.parts(True), {'text': ' and '}, *home.parts(False), {'text': f' tied {a}-{h}'}]
    else:
        (winner, w), (loser, l) = sorted([(away, a), (home, h)], key=lambda t: -t[1])
        verb = ' shut out ' if l == 0 else ' beat '
        parts = [*winner.parts(True), {'text': verb}, *loser.parts(False), {'text': f' {w}-{l}'}]

    extras = []
    if game['game_type'] == 'SB':
        extras.append(f'in Super Bowl {roman(game["season"] - 1965)}')
    elif game['game_type'] == 'CON':
        conf = home.conf or away.conf
        extras.append(f'in the {conf} championship game' if conf else 'in a conference championship game')
    elif game['game_type'] in ROUNDS:
        extras.append(f'in {ROUNDS[game["game_type"]]}')
    if game['overtime'] == 1:
        extras.append('in overtime')
    underdog = underdog_points(game)
    if underdog >= UPSET_POINTS:
        extras.append(f'as {points(underdog)}-point underdogs')
    if a + h >= SHOOTOUT_TOTAL:
        extras.append(f'with {a + h} combined points')
    if is_cold(game):
        extras.append(f'at {game["temp"]} degrees')

    text = (' ' + ' '.join(extras)) if extras else ''
    parts.append({'text': f'{text}.'})
    return merge(parts)


def merge(parts: list[dict]) -> list[dict]:
    """Join neighboring plain text parts."""
    out: list[dict] = []
    for part in parts:
        if out and 'team' not in part and 'team' not in out[-1]:
            out[-1] = {'text': out[-1]['text'] + part['text']}
        else:
            out.append(part)
    return out


def build_on_this_day(games: list[dict], team_rows: list[dict], today: date) -> dict:
    """Pure function to the OnThisDayData shape in src/data/types.ts."""
    teams = team_table(team_rows)
    on_date = [
        g for g in games
        if g['away_score'] is not None and g['home_score'] is not None
        and g['gameday'][5:] == today.strftime('%m-%d')
        and g['gameday'] < today.isoformat()
    ]
    ranked = sorted(
        (g for g in on_date if notability(g) > 0),
        key=lambda g: (-notability(g), -g['season'], g['game_id']),
    )
    picked: list[dict] = []
    for game in ranked:
        if len(picked) == MAX_ITEMS:
            break
        if all(p['season'] != game['season'] for p in picked):
            picked.append(game)
    picked.sort(key=lambda g: g['gameday'], reverse=True)

    items = []
    for game in picked:
        parts = describe(game, teams)
        items.append({
            'year': int(game['gameday'][:4]),
            'gameId': game['game_id'],
            'text': ''.join(p['text'] for p in parts),
            'parts': parts,
        })
    return {'month': today.month, 'day': today.day, 'gamesOnDate': len(on_date), 'items': items}


def load_on_this_day_input() -> tuple[list[dict], list[dict]]:
    import nflreadpy as nfl

    games = nfl.load_schedules(True).select(SCHEDULE_COLUMNS).to_dicts()
    teams = nfl.load_teams().select('team_abbr', 'team_nick', 'team_conf').to_dicts()
    return games, teams
