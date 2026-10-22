/**
 * draft_order.json, if the daily run has written one. Loaded by glob so a
 * checkout without the file still builds: the pages then show their
 * missing state.
 */
import type { DraftOrderData } from '../data/types';
import { draftState } from '../lib/draft/view';
import { asOfContext } from './as-of';
import { siteNow } from './now';

const files = import.meta.glob<DraftOrderData>('../data/draft_order.json', { eager: true, import: 'default' });

export const draftData: DraftOrderData | null = Object.values(files)[0] ?? null;

export const draft = draftState(draftData, siteNow(), asOfContext.season);
