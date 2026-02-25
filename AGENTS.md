# OpenKanban — Agent Entry Point

Workflow orchestration dashboard built on OpenClaw. User triggers, monitors, and approves multi-step AI pipelines from this dashboard.

**Core principle:** OpenClaw is the orchestrator. OpenKanban is the visual control surface.

## Stack
Next.js 14 + TypeScript + Tailwind + SQLite (better-sqlite3) + Zustand + WebSocket (OpenClaw Gateway)

## Quick Start
```bash
cd ~/clawd/projects/openkanban/app
npm install
npm run dev          # port 3000
```

## Key Files
```
src/lib/workflow-engine.ts         # Execution engine: templates, runs, steps
src/lib/workflow-intelligence.ts   # Outcome tracking, success rates
src/lib/workflow-router.ts         # Semantic routing (4-path LLM)
src/lib/openclaw/client.ts         # Gateway client (WS + HTTP)
src/app/api/workflows/trigger/     # Agent-initiated trigger endpoint
src/components/pipeline/           # PipelineCard, StepChain, StepDetail, Filters
src/components/MissionPrompt.tsx   # Primary trigger UI (text → agent figures out steps)
src/components/LiveAgentsSidebar.tsx # Active sub-agent display
config/content-scout/              # Channel configs, presets
scripts/content-scout/             # Pipeline scripts (Python)
```

## Docs
| Topic | Read |
|-------|------|
| Architecture (workflow engine, gateway, DB) | `docs/architecture.md` |
| Workflow engine deep dive | `docs/workflow-engine.md` |
| Deployment & setup | `docs/deployment.md` |
| Operations (dev, debug, SQLite) | `docs/operations.md` |
| Realtime system (SSE, WebSocket) | `docs/realtime.md` |
| Content pipeline (Scout + Transcript) | `docs/content-pipeline.md` |
| Feature specs | `docs/specs/` |

## Lint
```bash
npx eslint src/ --rulesdir eslint-rules/rules    # or: npm run lint
```
Custom rules: `no-console-log` (warn) via `--rulesdir`.
Built-in: `no-restricted-imports` blocks direct orchestration outside gateway client.

## Gateway Config Required
```json
{ "gateway.tools.allow": ["sessions_spawn", "sessions_send", "cron"] }
```
