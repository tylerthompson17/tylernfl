/**
 * URL slug for a player name: lowercase, punctuation dropped, spaces to
 * dashes. "Amon-Ra St. Brown" -> "amon-ra-st-brown", "C.J. Stroud" -> "cj-stroud".
 */
export function playerSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['.]/g, '')
    .replace(/\s+/g, '-');
}
