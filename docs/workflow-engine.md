---
title: Workflow Engine
domain: project
last-verified: 2026-02-25
status: current
---

# Workflow Engine Deep Dive

## Templates

Reusable pipeline definitions. Stored as JSON in SQLite.

```yaml
name: YouTube to Presentation
trigger: url (youtube.com)
steps:
  - name: Extract Transcript
    agent_role: transcription
    tools: [youtube-transcript]
    output: transcript.md
  - name: Summarize
    depends_on: Extract Transcript
    output: summary.md
  - name: Generate Deck
    depends_on: Summarize
    tools: [gamma-api]
    review: true        # pause for human approval
  - name: Distribute
    depends_on: Generate Deck
    approved: true
    destinations: [discord, notion]
```

## Execution Flow

1. User triggers (MissionPrompt text input or POST /api/workflows/trigger)
2. Semantic router picks template (4 paths: auto-execute, suggest, clarify, propose)
3. Workflow engine creates a run + steps
4. Each step → `sessions_spawn` with task description
5. Step completion → check dependencies → trigger next
6. Review steps pause and wait for `sessions_send` approval
7. Intelligence tracks outcome (success/failure rate per template)

## Semantic Router (4 Paths)

| Path | Confidence | Action |
|------|-----------|--------|
| A: Auto-execute | High | Trigger pipeline immediately |
| B: Suggest | Medium | Show Hans the matched template, ask confirm |
| C: Clarify | Low | Ask for more details |
| D: Propose | None match | Suggest creating a new template |

## Intelligence

- Rolling success rate per template
- Auto-flag at <60% success
- Counterexample tracking (what went wrong)
- Status field is canonical (not outcome — that has detailed messages)

## Schedule Triggers

OpenClaw cron integration:
- Create: `cron.add` with agentTurn
- Delete: `cron.remove` by jobId
- Cron returns results in `content[].text` JSON, not directly as `result.jobId`

## Seeded Templates
3 examples: YouTube→Presentation, Trade Analysis, Wednesday Show

## Key Lessons
- Skills ≠ workflow templates. Skills auto-activate in OpenClaw; don't wrap them as pipelines.
- `sessions_spawn` is HTTP-only (not WebSocket RPC) for UI clients
