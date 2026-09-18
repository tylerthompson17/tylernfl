/** Guards for reading ESPN's undocumented JSON defensively. */

export type Json = Record<string, unknown>;

export const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;
