import { chooseAction } from './ai.ts';
import type { Observation } from './types.ts';
self.onmessage = (event: MessageEvent<Observation>) => {
  try {
    self.postMessage({ action: chooseAction(event.data) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
