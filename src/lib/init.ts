/**
 * Global initialization — runs once on module load.
 * Import this from any API route that needs the workflow poller active.
 */
import { startCompletionPoller } from './workflow-engine';
import { seedContentScoutTemplate } from './content-scout/seed';

let initialized = false;

export function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;
  seedContentScoutTemplate();
  startCompletionPoller();
  console.log('[Init] OpenKanban services started');
}

// Auto-init on import
ensureInitialized();
