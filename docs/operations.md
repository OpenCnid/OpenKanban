---
title: Operations
domain: project
last-verified: 2026-02-25
status: current
---

# OpenKanban Operations

## Dev Workflow
```bash
cd ~/clawd/projects/openkanban/app
npm run dev              # port 3000
npm run build            # production build
npm test                 # if test suite exists
bash test-suite.sh       # 73 tests across 20 categories
```

## Key UI Components

| Component | Purpose |
|-----------|---------|
| MissionPrompt | Primary trigger — Hans types what he needs |
| LiveAgentsSidebar | Shows active sub-agents with real tasks |
| PipelineCard | Visual pipeline with step chain |
| PipelineStepDetail | Expanded step view |
| NotificationCenter | Bell dropdown with badges |
| GlobalSearch | Cmd+K federated search |
| QuickChat | Floating chat drawer |
| MemoryBrowser | Mem0 memory browsing |

## SQLite Access
```bash
sqlite3 data/openkanban.db
.tables
.schema workflow_templates
SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT 5;
```

## Testing
Test suite: `test-suite.sh` — 73 tests across 20 categories. All passing as of commit `3e4970f`.

## Build Status
- 28+ commits through `3e4970f`
- 73/73 test suite passing
- Weeks 1-5 complete

## Critical UX Note
Template editor was replaced with MissionPrompt. Hans types what he needs, agent figures out steps. OpenKanban is a monitoring dashboard, not a workflow IDE. "New Workflow" → "New Mission".
