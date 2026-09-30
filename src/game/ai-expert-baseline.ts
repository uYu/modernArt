// Frozen pre-upgrade expert route for paired evaluations and rollback.
import { chooseAction as search } from './ai-search.ts';
import { chooseAction as market } from './ai.ts';
import type { Observation, Action } from './types.ts';
export function chooseAction(o: Observation): Action {
  return o.phase === 'offer' || o.phase === 'pair'
    ? search(o, true)
    : market(o);
}
