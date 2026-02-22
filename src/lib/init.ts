/**
 * Global initialization — runs once on module load.
 * Import this from any API route that needs the workflow poller active.
 */
import { startCompletionPoller } from './workflow-engine';

let initialized = false;

export function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;
  startCompletionPoller();
  console.log('[Init] OpenKanban services started');
}

// Auto-init on import
ensureInitialized();
