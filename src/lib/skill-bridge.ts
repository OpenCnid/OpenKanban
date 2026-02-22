/**
 * Skill-to-Workflow Bridge — auto-registers OpenClaw skills as workflow templates.
 *
 * Parses SKILL.md files from the OpenClaw skills directory and converts
 * multi-step skills into workflow templates visible in the Pipeline View.
 *
 * Two template sources:
 * - Skill-backed (origin: 'skill') — auto-registered from SKILL.md files
 * - Custom (origin: 'manual') — created by user/agent in dashboard
 *
 * Both appear identically in Pipeline View, both go through semantic routing,
 * both track outcomes.
 */

import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run } from '@/lib/db';
import type { WorkflowTemplate } from '@/lib/types';
import * as fs from 'fs';
import * as path from 'path';

// --- Types ---

export interface SkillDefinition {
  name: string;
  description: string;
  location: string;
  steps: Array<{
    name: string;
    agent_role?: string;
    tools?: string[];
    depends_on?: string;
    review?: boolean;
    output?: string;
  }>;
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
  details: Array<{
    name: string;
    action: 'imported' | 'updated' | 'skipped' | 'error';
    templateId?: string;
    reason?: string;
  }>;
}

// --- Known Skills (hardcoded definitions for well-known skills) ---

const KNOWN_SKILLS: SkillDefinition[] = [
  {
    name: 'Triage',
    description: 'Parse brain dumps and stream-of-consciousness input into categorized, actionable items. Routes tasks, ideas, notes, events, and follow-ups to appropriate destinations.',
    location: 'triage',
    steps: [
      { name: 'Parse Input', agent_role: 'parser', output: 'parsed_items.json' },
      { name: 'Categorize Items', agent_role: 'classifier', depends_on: 'Parse Input', output: 'categorized.json' },
      { name: 'Route Items', agent_role: 'router', depends_on: 'Categorize Items', output: 'routing_results.json' },
      { name: 'Review Routing', agent_role: 'reviewer', depends_on: 'Route Items', review: true },
    ],
  },
  {
    name: 'Deep Research',
    description: 'Multi-phase research with parallel retrieval, claim extraction, deduplication, and citation-verified synthesis. For complex topics requiring multiple sources.',
    location: 'deep-research',
    steps: [
      { name: 'Plan Research', agent_role: 'planner', output: 'research_plan.json' },
      { name: 'Retrieve Sources', agent_role: 'retriever', depends_on: 'Plan Research', output: 'sources/' },
      { name: 'Read & Extract Claims', agent_role: 'reader', depends_on: 'Retrieve Sources', output: 'claims.json' },
      { name: 'Synthesize Report', agent_role: 'synthesizer', depends_on: 'Read & Extract Claims', output: 'draft.md', review: true },
      { name: 'Verify Citations', agent_role: 'verifier', depends_on: 'Synthesize Report', output: 'report.md' },
    ],
  },
];

// --- Core Functions ---

/**
 * Scan for SKILL.md files in common OpenClaw skill locations.
 */
function discoverSkillPaths(): string[] {
  const paths: string[] = [];
  const searchDirs = [
    // Global npm skills
    path.join(process.env.HOME || '/home/molt', '.npm-global/lib/node_modules/openclaw/skills'),
    // Workspace skills
    path.join(process.env.HOME || '/home/molt', 'clawd/skills'),
  ];

  for (const dir of searchDirs) {
    try {
      if (fs.existsSync(dir)) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillMd = path.join(dir, entry.name, 'SKILL.md');
            if (fs.existsSync(skillMd)) {
              paths.push(skillMd);
            }
          }
        }
      }
    } catch {
      // Skip inaccessible dirs
    }
  }

  return paths;
}

/**
 * Parse a SKILL.md file into a basic skill definition.
 * This is a best-effort parser — complex skills may need manual registration.
 */
function parseSkillMd(filePath: string): SkillDefinition | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const dirName = path.basename(path.dirname(filePath));

    // Extract name from first heading
    const nameMatch = content.match(/^#\s+(.+)/m);
    const name = nameMatch ? nameMatch[1].trim() : dirName;

    // Extract description from first paragraph after heading
    const descMatch = content.match(/^#\s+.+\n+([\s\S]+?)(?:\n\n|\n#)/);
    const description = descMatch ? descMatch[1].trim().slice(0, 300) : `Skill: ${name}`;

    // Look for phase/step sections
    const steps: SkillDefinition['steps'] = [];
    const stepPatterns = [
      /##\s+(?:Phase|Step)\s+\d+[:\s]+(.+)/gi,
      /\d+\.\s+\*\*(.+?)\*\*/g,
    ];

    for (const pattern of stepPatterns) {
      let match;
      let prevName: string | null = null;
      while ((match = pattern.exec(content)) !== null) {
        const stepName = match[1].trim();
        steps.push({
          name: stepName,
          agent_role: 'general',
          depends_on: prevName || undefined,
        });
        prevName = stepName;
      }
      if (steps.length > 0) break;
    }

    // If no steps found, create a single-step wrapper
    if (steps.length === 0) {
      steps.push(
        { name: `Execute ${name}`, agent_role: 'general' },
        { name: 'Review Output', agent_role: 'reviewer', depends_on: `Execute ${name}`, review: true },
      );
    }

    return { name, description, location: dirName, steps };
  } catch {
    return null;
  }
}

/**
 * Import skills as workflow templates.
 * - Known skills use hardcoded definitions (reliable step structures)
 * - Discovered skills are parsed from SKILL.md (best effort)
 */
export function importSkills(workspaceId: string = 'default'): ImportResult {
  const result: ImportResult = { imported: 0, updated: 0, skipped: 0, errors: [], details: [] };

  // Start with known skills
  const allSkills: SkillDefinition[] = [...KNOWN_SKILLS];

  // Discover additional skills from filesystem
  const discoveredPaths = discoverSkillPaths();
  for (const skillPath of discoveredPaths) {
    const dirName = path.basename(path.dirname(skillPath));
    // Skip if already covered by known skills
    if (KNOWN_SKILLS.some(k => k.location === dirName)) continue;

    const parsed = parseSkillMd(skillPath);
    if (parsed) {
      allSkills.push(parsed);
    }
  }

  // Import each skill as a workflow template
  for (const skill of allSkills) {
    try {
      // Check if already imported (by name + origin)
      const existing = queryOne<WorkflowTemplate>(
        "SELECT * FROM workflow_templates WHERE name = ? AND origin = 'skill' AND workspace_id = ?",
        [skill.name, workspaceId]
      );

      if (existing) {
        // Update the existing template's steps if they changed
        const existingSteps = typeof existing.steps === 'string'
          ? JSON.parse(existing.steps as unknown as string)
          : existing.steps;
        const newStepsJson = JSON.stringify(skill.steps);
        const existingStepsJson = JSON.stringify(existingSteps);

        if (newStepsJson !== existingStepsJson) {
          run(
            `UPDATE workflow_templates SET steps = ?, description = ?, updated_at = datetime('now') WHERE id = ?`,
            [newStepsJson, skill.description, existing.id]
          );
          result.updated++;
          result.details.push({ name: skill.name, action: 'updated', templateId: existing.id });
        } else {
          result.skipped++;
          result.details.push({ name: skill.name, action: 'skipped', reason: 'No changes' });
        }
        continue;
      }

      // Create new template
      const templateId = uuidv4();
      const now = new Date().toISOString();
      run(
        `INSERT INTO workflow_templates (id, name, description, trigger_type, steps, workspace_id, icon, enabled, origin, status, created_at, updated_at)
         VALUES (?, ?, ?, 'manual', ?, ?, ?, 1, 'skill', 'active', ?, ?)`,
        [
          templateId,
          skill.name,
          skill.description,
          JSON.stringify(skill.steps),
          workspaceId,
          skill.name === 'Triage' ? '🧠' : skill.name === 'Deep Research' ? '🔬' : '🔧',
          now,
          now,
        ]
      );

      result.imported++;
      result.details.push({ name: skill.name, action: 'imported', templateId });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`${skill.name}: ${errMsg}`);
      result.details.push({ name: skill.name, action: 'error', reason: errMsg });
    }
  }

  return result;
}

/**
 * Get all skill-backed templates.
 */
export function getSkillTemplates(workspaceId: string = 'default'): WorkflowTemplate[] {
  return queryAll<WorkflowTemplate>(
    "SELECT * FROM workflow_templates WHERE origin = 'skill' AND workspace_id = ?",
    [workspaceId]
  );
}
