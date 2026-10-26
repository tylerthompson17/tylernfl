/**
 * The experimental calculator's punter menu, from the model's own tables:
 * teamPunters.json (each team's most recent punter, weekly) and punter.json
 * (every punter with a fitted effect). A punter is named from punter.json,
 * else from teamPunters.json; one in neither (a stored record's punter the
 * tables do not know) is named by its ESPN id. Pure, so it is tested
 * against the real files.
 */

export interface PunterOption {
  id: string;
  /** "T. Doman (BUF)" for a team's current punter, "J. Hekker" otherwise */
  label: string;
}

export interface PunterMenu {
  /** Each team's most recent punter, by team, named; null name when no table names him */
  team: Record<string, { id: string; name: string } | null>;
  /** Every team's current punter, by team */
  current: PunterOption[];
  /** Every other punter the model has an effect for, by name */
  others: PunterOption[];
}

type TeamPunters = { teams: Record<string, { punterId: string | null; name: string | null }> };
type Punters = { punters: Record<string, { name: string }> };

/** The menu; `extra` adds ids the tables may not have (punters of stored plays). */
export function punterMenu(teamPunters: TeamPunters, punters: Punters, extra: Iterable<string> = []): PunterMenu {
  const nameOf = (id: string): string | null => punters.punters[id]?.name ?? null;
  const team: PunterMenu['team'] = {};
  const current: PunterOption[] = [];
  const taken = new Set<string>();
  for (const [abbr, p] of Object.entries(teamPunters.teams).sort(([a], [b]) => a.localeCompare(b))) {
    if (!p.punterId) {
      team[abbr] = null;
      continue;
    }
    const name = nameOf(p.punterId) ?? p.name ?? `ESPN id ${p.punterId}`;
    team[abbr] = { id: p.punterId, name };
    if (!taken.has(p.punterId)) current.push({ id: p.punterId, label: `${name} (${abbr})` });
    taken.add(p.punterId);
  }
  const others = Object.entries(punters.punters)
    .filter(([id]) => !taken.has(id))
    .map(([id, p]) => ({ id, label: p.name }));
  for (const id of extra) {
    if (!taken.has(id) && !(id in punters.punters)) others.push({ id, label: `Punter with ESPN id ${id}` });
    taken.add(id);
  }
  others.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return { team, current, others };
}

/** The default option's words: "BUF's most recent punter: T. Doman". */
export function defaultPunterLabel(menu: PunterMenu, offense: string): string {
  const p = menu.team[offense];
  return p ? `${offense}'s most recent punter: ${p.name}` : `${offense}: no recent punter, league average`;
}

/** Every id the menu offers. */
export const punterIds = (menu: PunterMenu): Set<string> => new Set([...menu.current, ...menu.others].map((p) => p.id));
