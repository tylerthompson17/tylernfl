/**
 * URL slug for a player name: accents dropped, lowercase, apostrophes and
 * periods removed rather than turned into separators, every other run of
 * punctuation or space collapsed to one dash.
 *
 * "Amon-Ra St. Brown" -> "amon-ra-st-brown", "C.J. Stroud" -> "cj-stroud",
 * "Audric Estimé" -> "audric-estime".
 *
 * Must stay in step with player_slug in pipelines/common.py, which writes
 * the slugs in src/data/rosters/. Players who share a name get a team
 * suffix there, so roster links use the written slug and this function is
 * for links built from a name alone.
 */
export function playerSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
