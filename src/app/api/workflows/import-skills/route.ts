import { NextRequest, NextResponse } from 'next/server';
import { importSkills, getSkillTemplates } from '@/lib/skill-bridge';

// POST /api/workflows/import-skills — scan and import skills as templates
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const workspaceId = body.workspace_id || 'default';

  try {
    const result = importSkills(workspaceId);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[SkillBridge] Import failed:', err);
    return NextResponse.json(
      { error: `Import failed: ${err instanceof Error ? err.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

// GET /api/workflows/import-skills — list skill-backed templates
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspace_id') || 'default';

  const templates = getSkillTemplates(workspaceId);
  return NextResponse.json(templates);
}
