export const PIPELINE_STATUS = { RUNNING: 'running', COMPLETE: 'complete', FAILED: 'failed', PENDING: 'pending' } as const;
export type PipelineStatus = typeof PIPELINE_STATUS[keyof typeof PIPELINE_STATUS];
