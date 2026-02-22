import { NextRequest, NextResponse } from 'next/server';
import { getAllTemplateHealth, getTemplateHealth } from '@/lib/workflow-intelligence';

// GET /api/workflows/health — get template health scores
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const templateId = searchParams.get('template_id');
  const workspaceId = searchParams.get('workspace_id') || 'default';

  if (templateId) {
    const health = getTemplateHealth(templateId);
    if (!health) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    return NextResponse.json(health);
  }

  const allHealth = getAllTemplateHealth(workspaceId);
  return NextResponse.json(allHealth);
}
