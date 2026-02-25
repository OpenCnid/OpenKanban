---
title: Architecture
domain: project
last-verified: 2026-02-25
status: current
---

# OpenKanban Architecture

## Core Principle

**OpenKanban does NOT implement orchestration.** It translates user intent into OpenClaw operations:

| Dashboard Action | OpenClaw Operation |
|-----------------|-------------------|
| Trigger pipeline | `sessions_spawn` per step (chained) |
| Monitor progress | `sessions_list` + `sessions_history` |
| Approve/reject | `sessions_send` to waiting session |
| Schedule pipeline | `cron.add` (agentTurn) |
| Search memories | `memory_search` via Mem0 |
| Chat with agent | `sessions_send` to main session |
| Cancel step | `subagents.kill` |

## System Diagram

```
Hans → voice/text → OpenClaw (triage) → parsed items →
  → Simple task → kanban card
  → Complex need → POST /api/workflows/trigger → semantic router →
    → High confidence → auto-trigger pipeline
    → Low confidence → notify Hans to decide
  → Pipeline runs (sessions_spawn per step) → review checkpoints →
  → Pipeline complete → outcomes tracked → distribute
```

## Key Modules

| Module | File | Purpose |
|--------|------|---------|
| Workflow Engine | `src/lib/workflow-engine.ts` | Template CRUD, run creation, step execution |
| Intelligence | `src/lib/workflow-intelligence.ts` | Rolling success rate, auto-flag at <60% |
| Semantic Router | `src/lib/workflow-router.ts` | 4-path LLM routing (auto/suggest/clarify/propose) |
| Gateway Client | `src/lib/openclaw/client.ts` | WebSocket + HTTP to OpenClaw |
| Agent Trigger | `src/app/api/workflows/trigger/route.ts` | Inbound bridge from agents |

## Data Layer (SQLite)

Extends upstream mission-control schema with:
- Workflow templates (JSON in SQLite)
- Pipeline runs + steps with status tracking
- Outcome intelligence (success rates, counterexamples)
- Schedule triggers (OpenClaw cron integration)

## Views

| View | Purpose | Primary User |
|------|---------|-------------|
| **Pipelines** (primary) | Monitor running workflows, trigger, approve | Hans (daily) |
| **Tasks** (secondary) | Flat view of all tasks, ad-hoc, drag-and-drop | Debugging |
| **Approvals** | Pending review items with approve/reject | Hans |
| **Dashboard** | Stats cards, active pipelines, recent activity | Hans |

## Agent Communication

All pipeline steps use `anthropic/claude-sonnet-4-6` (not opus — too expensive/slow).

Agent protocol: sub-agents register via gateway, log activities to tasks, track deliverables, update status through the task lifecycle: INBOX → ASSIGNED → IN_PROGRESS → TESTING → REVIEW → DONE.

## Technical Decisions
1. **OpenClaw is orchestrator** — OpenKanban never dispatches agents directly
2. **Pipeline view is primary** — kanban is secondary/power-user
3. **Fork, not rewrite** — ~7,400 lines of upstream code preserved
4. **SQLite stays** — local, no cloud dependency, good enough for single-user
5. **Workflow templates as JSON in SQLite** — flexible, no schema migrations per template
6. **LLM routing over embeddings** — more accurate for small template libraries
7. **Not everything needs workflows** — webhooks/scripts for deterministic work
