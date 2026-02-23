/**
 * Content Scout — TypeScript type definitions
 * Mirrors the Python data models from CONTENT-SCOUT-SPEC.md §6
 */

export interface VideoRecord {
  id: string;
  url: string;
  title: string;
  channelId: string;
  channelName: string;
  channelSlug: string;
  uploadDate: string;
  duration: number;
  score: number;
  processedAt?: string;
  status: 'pending' | 'downloading' | 'extracting' | 'transcribing' | 'classifying' | 'storing' | 'complete' | 'failed';
  framesExtracted?: number;
  framesKept?: number;
  hasTranscript?: boolean;
  transcriptMinutes?: number;
  error?: string;
}

export type FrameCategory = 'CHART' | 'GRAPH' | 'TABLE' | 'SLIDE' | 'SCREEN';
export type DiscardCategory = 'TALKING_HEAD' | 'FILLER';
export type AllCategories = FrameCategory | DiscardCategory;

export interface FrameAnnotation {
  what: string;
  keyData: string[];
  verbalContext: string;
  insight: string;
  relevance: number; // 1-5
  tags: string[];
  contentAngle: string;
  ticker: string | null;
  timeframe: string | null;
  indicators: string[];
}

export interface FrameRecord {
  id: string;
  videoId: string;
  frameNumber: number;
  timestamp: number;
  sourceUrl: string;
  filePath: string;
  pHash: string;
  category: FrameCategory;
  confidence: number;
  annotation: FrameAnnotation;
  notionBlockId?: string;
}

export interface DiscardedFrame {
  videoId: string;
  timestamp: number;
  category: AllCategories;
  confidence: number;
  keep: false;
}

export interface ChannelRecord {
  id: string;
  name: string;
  slug: string;
  url: string;
  subscriberCount?: number;
  priority: 'high' | 'medium' | 'low';
  status: 'active' | 'pending' | 'rejected' | 'paused';
  addedAt: string;
  lastChecked?: string;
  videosProcessed?: number;
  avgRelevance?: number;
  usedRate?: number;
  notes?: string;
  discoveredBy: 'manual' | 'auto';
}

export interface DailyStats {
  videosScanned: number;
  videosProcessed: number;
  framesExtracted: number;
  framesKept: number;
  notionEntriesCreated: number;
  topTickers: string[];
  transcriptMinutes: number;
  llmCalls: number;
  estimatedCost: number;
}

export interface ProcessingLog {
  lastRun: string;
  videosProcessed: string[];
  dailyStats: Record<string, DailyStats>;
}

export interface PipelineState {
  date: string;
  videoUrl: string | null;
  startedAt: string;
  steps: Record<string, {
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    message?: string;
    updatedAt: string;
  }>;
}

export interface PipelineRunResult {
  date: string;
  videoUrl: string | null;
  dryRun: boolean;
  completed: string[];
  failed: string[];
  stateFile: string | null;
}

export interface ContentScoutConfig {
  pipeline: {
    dailyVideoLimit: number;
    maxVideoDurationMinutes: number;
    minVideoDurationMinutes: number;
    frameIntervalSeconds: number;
    phashHammingThreshold: number;
    classificationConfidenceThreshold: number;
    annotationBatchSize: number;
    transcriptWindowSeconds: number;
    imageMaxWidth: number;
    imageQuality: number;
    imageFormat: string;
  };
  scoring: {
    recencyWeight: number;
    priorityWeight: number;
    keywordWeight: number;
  };
  notion: {
    contentVaultDatabaseId: string;
    dailyBriefsDatabaseId: string;
    channelsDatabaseId: string;
    rateLimitMs: number;
  };
  schedule: {
    dailyPipelineCron: string;
    weeklyDiscoveryCron: string;
    timezone: string;
  };
}
