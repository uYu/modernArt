import { chooseConfiguredAction } from './ai-configured.ts';
import type { Observation } from './types.ts';
import type { AIConfig } from './preferences.ts';
self.onmessage = (
  event: MessageEvent<{ observation: Observation; config?: AIConfig }>,
) => {
  try {
    self.postMessage({
      action: chooseConfiguredAction(event.data.observation, event.data.config),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
