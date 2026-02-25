/**
 * Workflow Router — semantic routing for natural language input.
 *
 * 4-path routing:
 * Path A: High confidence (>0.85) → auto-execute single template match
 * Path B: Multiple matches (0.6–0.85) → suggest options, let user pick
 * Path C: Vague (<0.6) → ask user to clarify
 * Path D: No match (<0.3) → agent proposes new workflow steps
 *
 * Implementation: LLM-based for <50 templates (feed catalog as context).
 * Upgrade to embedding search when library grows past ~50.
 */

import { queryAll } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { recordRetrieval } from '@/lib/workflow-intelligence';
import type { WorkflowTemplate, WorkflowStep } from '@/lib/types';

// --- Types ---

export type RoutingPath = 'A' | 'B' | 'C' | 'D';

export interface RoutingResult {
  path: RoutingPath;
  confidence: number;
  reasoning: string;

  // Path A: single match
  matchedTemplateId?: string;
  matchedTemplateName?: string;

  // Path B: multiple matches
  suggestions?: Array<{
    templateId: string;
    templateName: string;
    confidence: number;
    reasoning: string;
  }>;

  // Path C: clarification needed
  clarificationPrompt?: string;

  // Path D: proposed new workflow
  proposedWorkflow?: {
    name: string;
    description: string;
    steps: Array<{
      name: string;
      agent_role?: string;
      tools?: string[];
      depends_on?: string;
      review?: boolean;
      output?: string;
    }>;
  };
}

// --- Constants ---

const PATH_A_THRESHOLD = 0.85;
const PATH_B_THRESHOLD = 0.6;
const PATH_D_THRESHOLD = 0.3;

// --- Core Functions ---

function buildTriggerPhrases(template: WorkflowTemplate, steps: WorkflowStep[]): string[] {
  const name = template.name.toLowerCase();

  if (name === 'content scout daily brief') {
    return [
      'content scout',
      'daily brief',
      'youtube uploads',
      'channel monitoring',
      'content brief',
    ];
  }

  if (name === 'transcript studio') {
    return [
      'transcript studio',
      'speaker diarized transcript',
      'video chapters',
      'shorts candidates',
      'notion transcript page',
    ];
  }

  const fallback = steps
    .slice(0, 3)
    .map((s) => s.name.toLowerCase())
    .filter(Boolean);

  return fallback.length > 0 ? fallback : [template.name.toLowerCase()];
}

/**
 * Build a catalog summary of all active templates for LLM context.
 */
function buildTemplateCatalog(templates: WorkflowTemplate[]): string {
  if (templates.length === 0) {
    return 'No workflow templates are currently available.';
  }

  return templates.map((t, i) => {
    const steps = typeof t.steps === 'string' ? JSON.parse(t.steps as unknown as string) : t.steps;
    const typedSteps = steps as WorkflowStep[];
    const stepNames = typedSteps.map(s => s.name).join(' → ');
    const triggerPhrases = buildTriggerPhrases(t, typedSteps).join(', ');
    return `[${i + 1}] ID: ${t.id}
    Name: ${t.name}
    Description: ${t.description || 'No description'}
    Trigger: ${t.trigger_type}
    Trigger phrases: ${triggerPhrases}
    Steps: ${stepNames}
    Success rate: ${t.success_rate != null ? `${(t.success_rate * 100).toFixed(0)}%` : 'N/A'}
    Total runs: ${t.total_runs}`;
  }).join('\n\n');
}

/**
 * Build the routing prompt for the LLM.
 */
function buildRoutingPrompt(userInput: string, catalog: string): string {
  return `You are a workflow routing system. Given a user's input, determine which workflow template to use.

## Available Templates
${catalog}

## User Input
"${userInput}"

## Instructions
Analyze the user input and respond with a JSON object. Do NOT include any text outside the JSON.

If a template clearly matches (confidence > 0.85):
{
  "path": "A",
  "confidence": 0.92,
  "reasoning": "Brief explanation",
  "matchedTemplateId": "the-template-id",
  "matchedTemplateName": "Template Name"
}

If multiple templates could match (confidence 0.6–0.85):
{
  "path": "B",
  "confidence": 0.72,
  "reasoning": "Brief explanation",
  "suggestions": [
    { "templateId": "id1", "templateName": "Name 1", "confidence": 0.75, "reasoning": "why" },
    { "templateId": "id2", "templateName": "Name 2", "confidence": 0.65, "reasoning": "why" }
  ]
}

If the input is too vague to match (confidence 0.3–0.6):
{
  "path": "C",
  "confidence": 0.45,
  "reasoning": "Brief explanation",
  "clarificationPrompt": "Ask the user a specific question to narrow their intent"
}

If no template matches and you should propose a new workflow (confidence < 0.3):
{
  "path": "D",
  "confidence": 0.15,
  "reasoning": "No existing template covers this",
  "proposedWorkflow": {
    "name": "Suggested Workflow Name",
    "description": "What this workflow does",
    "steps": [
      { "name": "Step 1", "agent_role": "researcher" },
      { "name": "Step 2", "agent_role": "writer", "depends_on": "Step 1" },
      { "name": "Review Output", "agent_role": "reviewer", "depends_on": "Step 2", "review": true }
    ]
  }
}

Respond with ONLY the JSON object, no markdown fences, no extra text.`;
}

/**
 * Route user input through the 4-path system.
 * Uses OpenClaw sessions_spawn to call an LLM for routing decisions.
 */
export async function routeInput(
  userInput: string,
  workspaceId: string = 'default'
): Promise<RoutingResult> {
  // Get active templates
  const templates = queryAll<WorkflowTemplate>(
    'SELECT * FROM workflow_templates WHERE workspace_id = ? AND enabled = 1 AND status != ?',
    [workspaceId, 'retired']
  );

  // Edge case: no templates at all → always Path D
  if (templates.length === 0) {
    return {
      path: 'D',
      confidence: 0,
      reasoning: 'No workflow templates exist yet.',
      proposedWorkflow: {
        name: 'New Workflow',
        description: `Process: "${userInput}"`,
        steps: [
          { name: 'Execute Task', agent_role: 'general' },
          { name: 'Review Output', agent_role: 'reviewer', depends_on: 'Execute Task', review: true },
        ],
      },
    };
  }

  const catalog = buildTemplateCatalog(templates);
  const prompt = buildRoutingPrompt(userInput, catalog);

  // Use fast keyword/heuristic routing (LLM routing via sessions_spawn
  // doesn't return inline text — would need polling like the step executor).
  // Keyword matching is instant and works well for small template libraries.
  // TODO: Add LLM routing when template count exceeds ~20.
  return fallbackRoute(userInput, templates);
}

/**
 * Extract the text content from a sessions_spawn result.
 */
function extractResponseText(result: Record<string, unknown>): string {
  // sessions_spawn returns various shapes — try to find the text
  if (typeof result === 'string') return result;
  if (result.text) return result.text as string;
  if (result.content) return result.content as string;
  if (result.message) return result.message as string;
  if (result.result && typeof result.result === 'string') return result.result;
  // Try to find it in the full result
  return JSON.stringify(result);
}

/**
 * Parse the LLM's routing JSON response.
 */
function parseRoutingResponse(text: string): RoutingResult {
  // Try to extract JSON from the response
  let jsonStr = text.trim();

  // Strip markdown fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // Find the first { ... } block
  const braceStart = jsonStr.indexOf('{');
  const braceEnd = jsonStr.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (!parsed.path || !['A', 'B', 'C', 'D'].includes(parsed.path)) {
      throw new Error('Invalid path');
    }

    return {
      path: parsed.path,
      confidence: parsed.confidence ?? 0.5,
      reasoning: parsed.reasoning ?? 'No reasoning provided',
      matchedTemplateId: parsed.matchedTemplateId,
      matchedTemplateName: parsed.matchedTemplateName,
      suggestions: parsed.suggestions,
      clarificationPrompt: parsed.clarificationPrompt,
      proposedWorkflow: parsed.proposedWorkflow,
    };
  } catch {
    // If we can't parse, return a clarification request
    return {
      path: 'C',
      confidence: 0.3,
      reasoning: 'Could not parse routing response',
      clarificationPrompt: 'Could you be more specific about what you want to do?',
    };
  }
}

/**
 * Fallback keyword-based routing when LLM is unavailable.
 */
function fallbackRoute(userInput: string, templates: WorkflowTemplate[]): RoutingResult {
  const input = userInput.toLowerCase();

  // Simple keyword matching
  const scored = templates.map(t => {
    const name = t.name.toLowerCase();
    const desc = (t.description || '').toLowerCase();
    let score = 0;

    // Exact name match
    if (input.includes(name) || name.includes(input)) {
      score = 0.9;
    }

    // Word overlap
    const inputWords = input.split(/\s+/);
    const templateWords = `${name} ${desc}`.split(/\s+/);
    const overlap = inputWords.filter(w => templateWords.some(tw => tw.includes(w) || w.includes(tw)));
    if (overlap.length > 0) {
      score = Math.max(score, 0.3 + (overlap.length / inputWords.length) * 0.5);
    }

    return { template: t, score };
  }).filter(s => s.score > 0.2).sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      path: 'D',
      confidence: 0.1,
      reasoning: 'No keyword matches found',
      proposedWorkflow: {
        name: `Process: ${userInput.slice(0, 50)}`,
        description: userInput,
        steps: [
          { name: 'Execute', agent_role: 'general' },
          { name: 'Review', agent_role: 'reviewer', depends_on: 'Execute', review: true },
        ],
      },
    };
  }

  if (scored[0].score >= PATH_A_THRESHOLD) {
    recordRetrieval(scored[0].template.id);
    return {
      path: 'A',
      confidence: scored[0].score,
      reasoning: `Keyword match: "${scored[0].template.name}"`,
      matchedTemplateId: scored[0].template.id,
      matchedTemplateName: scored[0].template.name,
    };
  }

  if (scored[0].score >= PATH_B_THRESHOLD) {
    const suggestions = scored.slice(0, 3).map(s => {
      recordRetrieval(s.template.id);
      return {
        templateId: s.template.id,
        templateName: s.template.name,
        confidence: s.score,
        reasoning: `Keyword match`,
      };
    });
    return {
      path: 'B',
      confidence: scored[0].score,
      reasoning: 'Multiple possible matches',
      suggestions,
    };
  }

  return {
    path: 'C',
    confidence: scored[0].score,
    reasoning: 'Weak keyword matches, clarification needed',
    clarificationPrompt: `Did you mean "${scored[0].template.name}"? Or could you describe what you want in more detail?`,
  };
}
