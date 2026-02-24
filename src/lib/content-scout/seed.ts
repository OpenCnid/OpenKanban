import { v4 as uuidv4 } from 'uuid';
import { queryOne, run } from '@/lib/db';
import type { WorkflowStep } from '@/lib/types';

export const CONTENT_SCOUT_DAILY_TEMPLATE_NAME = 'Content Scout — Daily';
export const CONTENT_SCOUT_DAILY_TEMPLATE_KEY = 'content-scout-daily';

export const CONTENT_SCOUT_STEP_ORDER = [
  'select',
  'download',
  'extract',
  'transcribe',
  'window',
  'classify',
  'compress',
  'tags',
  'log',
  'notion',
  'brief',
  'archive',
  'cleanup',
] as const;

export type ContentScoutStepKey = typeof CONTENT_SCOUT_STEP_ORDER[number];

export const CONTENT_SCOUT_STEP_LABELS: Record<ContentScoutStepKey, string> = {
  select: 'Select Videos',
  download: 'Download Assets',
  extract: 'Extract Frames',
  transcribe: 'Transcribe Audio',
  window: 'Window Transcripts',
  classify: 'Classify & Annotate',
  compress: 'Compress & Store',
  tags: 'Build Tag Index',
  log: 'Update Processing Log',
  notion: 'Sync to Notion',
  brief: 'Generate Brief',
  archive: 'Archive Transcripts',
  cleanup: 'Cleanup Temp Files',
};

function buildTemplateSteps(): WorkflowStep[] {
  return CONTENT_SCOUT_STEP_ORDER.map((stepKey, index) => {
    const step: WorkflowStep = {
      name: CONTENT_SCOUT_STEP_LABELS[stepKey],
    };

    if (index > 0) {
      step.depends_on = CONTENT_SCOUT_STEP_LABELS[CONTENT_SCOUT_STEP_ORDER[index - 1]];
    }

    return step;
  });
}

/**
 * Ensure the Content Scout Daily template exists for workflow-run visualization.
 */
export function seedContentScoutTemplate(): void {
  const existing = queryOne<{ id: string }>(
    'SELECT id FROM workflow_templates WHERE name = ? AND workspace_id = ?',
    [CONTENT_SCOUT_DAILY_TEMPLATE_NAME, 'default']
  );

  if (existing?.id) {
    return;
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  run(
    `INSERT INTO workflow_templates
      (id, name, description, trigger_type, trigger_config, steps, workspace_id, icon, enabled, origin, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'active', ?, ?)`,
    [
      id,
      CONTENT_SCOUT_DAILY_TEMPLATE_NAME,
      'Content Scout deterministic daily pipeline (Python) mirrored in OpenKanban pipeline UI.',
      'manual',
      JSON.stringify({ key: CONTENT_SCOUT_DAILY_TEMPLATE_KEY }),
      JSON.stringify(buildTemplateSteps()),
      'default',
      '🛰️',
      'content-scout',
      now,
      now,
    ]
  );

  console.log(`[ContentScoutSeed] Created template "${CONTENT_SCOUT_DAILY_TEMPLATE_NAME}" (${id})`);
}
