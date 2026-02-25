---
title: Agent Profiles Spec
domain: project
last-verified: 2026-02-25
status: current
---

# Agent Profiles — Design Spec v2

*Refined 2026-02-22. Resolves all open questions from v1.*

---

## The Problem

Every pipeline step spawns a generic `claude-sonnet-4-6` session with a thin role string. No persistent identity, no specialized knowledge, no tool restrictions, no memory. Every agent starts from zero every time.

## The Insight

OpenClaw already has a full multi-agent architecture. We don't build — we integrate.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  OpenKanban UI                   │
│         (dashboard, approvals, pipeline)         │
└──────────────┬──────────────────┬────────────────┘
               │ HTTP API         │ SSE events
┌──────────────▼──────────────────▼────────────────┐
│              OpenKanban Server                    │
│         workflow-engine.ts                        │
│    ┌─────────────────────────────────────┐        │
│    │  sessions_spawn(agentId: "analyst") │        │
│    └──────────────┬──────────────────────┘        │
└───────────────────┼──────────────────────────────┘
                    │ Gateway HTTP API
┌───────────────────▼──────────────────────────────┐
│               OpenClaw Gateway                    │
│                                                   │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐       │
│  │ market-   │ │ analyst   │ │ recorder  │       │
│  │ data      │ │           │ │           │       │
│  │           │ │           │ │           │       │
│  │ SOUL.md   │ │ SOUL.md   │ │ SOUL.md   │       │
│  │ memory/   │ │ memory/   │ │ memory/   │       │
│  │ Sonnet    │ │ Opus      │ │ Sonnet    │       │
│  │ web tools │ │ read-only │ │ write     │       │
│  └───────────┘ └───────────┘ └───────────┘       │
│                                                   │
│  ┌─────────────────────────────────────────┐     │
│  │  Mem0 (shared userId: "stillforming")   │     │
│  │  Qdrant collection: "memories"          │     │
│  └─────────────────────────────────────────┘     │
│                                                   │
│  ┌─────────────────────────────────────────┐     │
│  │  Shared auth-profiles.json              │     │
│  │  (copied to each agent's agentDir)      │     │
│  └─────────────────────────────────────────┘     │
└──────────────────────────────────────────────────┘
```

---

## Resolved: Auth Sharing

**Decision: Shared auth.** All specialist agents use the same API keys.

**Implementation:** Copy `auth-profiles.json` from the main agent's `agentDir` to each specialist's `agentDir`:

```
~/.openclaw/agents/main/agent/auth-profiles.json
    ↓ copy to
~/.openclaw/agents/market-data/agent/auth-profiles.json
~/.openclaw/agents/analyst/agent/auth-profiles.json
~/.openclaw/agents/recorder/agent/auth-profiles.json
```

**Why this works:**
- Specialists are short-lived sub-agent sessions (30s–5min), not persistent services
- They share Cnid's Anthropic API quota regardless — separate keys wouldn't change the cost
- Single point of key rotation: update main → copy to specialists
- If we later need per-agent quotas (e.g., rate-limiting a chatty agent), we can split then

**Maintenance automation:** A simple script (or heartbeat task) can detect when `main/agent/auth-profiles.json` has changed and propagate to specialists.

---

## Resolved: Memory — Isolation vs Sharing

### Research Findings

We have **two independent memory systems** running simultaneously:

#### 1. OpenClaw Native Memory (workspace markdown)
- **Location:** Each agent's workspace (`MEMORY.md`, `memory/*.md`)
- **Index:** Per-agent SQLite at `~/.openclaw/memory/<agentId>.sqlite`
- **Scope:** Naturally isolated — each agent has its own workspace
- **What it stores:** Workspace files injected at session boot (SOUL.md, AGENTS.md, TOOLS.md, MEMORY.md, daily notes)
- **Access:** `read` tool for files + `memorySearch` for vector search of markdown

#### 2. Mem0 Plugin (Qdrant vector store)
- **Location:** Shared Qdrant collection `"memories"` on localhost:6333
- **Config:** `userId: "stillforming"`, single global collection
- **Scope:** Global — all agents share the same pool (no per-agent awareness in the plugin)
- **What it stores:** Conversational facts extracted by auto-capture (LLM-driven)
- **Session scope:** Uses `sessionKey` as `run_id` for session-scoped memories
- **Access:** `memory_search`, `memory_store`, `memory_list`, `memory_get`, `memory_forget`
- **Auto-behavior:** `autoRecall: true` (injects relevant memories before each turn), `autoCapture: true` (extracts facts after each turn)

### Decision: Hybrid — Workspace Isolated, Mem0 Shared

```
┌──────────────────────────────────────────────────────┐
│                 Per-Agent (ISOLATED)                   │
│                                                        │
│  market-data workspace    analyst workspace            │
│  ┌──────────────────┐    ┌──────────────────┐         │
│  │ SOUL.md (who)     │    │ SOUL.md (who)     │        │
│  │ AGENTS.md (how)   │    │ AGENTS.md (how)   │        │
│  │ TOOLS.md (notes)  │    │ TOOLS.md (notes)  │        │
│  │ MEMORY.md (role   │    │ MEMORY.md (role   │        │
│  │   knowledge)      │    │   knowledge)      │        │
│  │ memory/ (daily)   │    │ memory/ (daily)   │        │
│  └──────────────────┘    └──────────────────┘         │
│                                                        │
│  → Identity, role instructions, specialized knowledge  │
│  → "I am the analyst. Last time AAPL IV was 28%..."    │
│  → Per-agent SQLite vector index                       │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│                    Global (SHARED)                     │
│                                                        │
│  Mem0 / Qdrant                                         │
│  ┌──────────────────────────────────────────────┐     │
│  │ userId: "stillforming"                        │    │
│  │ collection: "memories"                        │    │
│  │                                               │    │
│  │ "Cnid trades OPTCG cards"                     │    │
│  │ "AAPL earnings on Feb 6"                      │    │
│  │ "Hans prefers simple language"                │    │
│  │ "TCGPlayer scraper uses 15s delays"           │    │
│  └──────────────────────────────────────────────┘     │
│                                                        │
│  → Factual knowledge, user preferences, world facts   │
│  → All agents can read/write                          │
│  → Auto-recall injects relevant context per query     │
└──────────────────────────────────────────────────────┘
```

### Why Hybrid Works

**Workspace isolation protects identity.** The analyst's SOUL.md says "you analyze data, you don't fetch it." If this leaked to the market-data agent, it would confuse the role boundary. Workspace files define WHO the agent is — they must stay separate.

**Shared Mem0 enables knowledge compounding.** When the market-data agent discovers "Yahoo Finance moved AAPL options to a different page layout," that fact is useful for the next time ANY agent needs AAPL data. Shared factual memory means the whole team gets smarter over time.

**Auto-recall is context-sensitive.** Mem0 searches by semantic similarity to the current query. A market-data agent asking about "AAPL options chain" will recall market-related memories, not analyst reasoning memories. The `topK: 5` + `searchThreshold: 0.3` filtering means irrelevant memories from other roles naturally fall below the threshold.

**Session scope handles cross-talk.** Mem0's `run_id` (sessionKey) scopes session memories. A market-data agent's session memories don't leak into an analyst agent's session — they're different sessions with different keys.

### Practical Concerns

**Noise risk:** An analyst agent might auto-recall a memory like "the scraper uses 15s delays." This is mildly irrelevant but not harmful — the agent will ignore it. The threshold filter catches most noise.

**Write conflicts:** If the market-data and analyst agents both auto-capture "AAPL is at $245," Mem0's deduplication handles this (it merges duplicate facts).

**Future enhancement — Mem0 metadata tagging:** If noise becomes a real problem, we can add metadata to memory_store calls (e.g., `{ source_agent: "market-data" }`) and filter by metadata in search. The Mem0 API supports this. Not needed now, but the escape hatch exists.

### What Each Agent's Workspace Contains

**market-data workspace:**
```
SOUL.md     → "You fetch financial data. Structured output. No analysis."
AGENTS.md   → Operating instructions for data fetching
TOOLS.md    → Notes: "Yahoo Finance layout changed 2026-02-15"
MEMORY.md   → "AAPL options on YF page 3. Polygon API has 5 calls/min limit."
memory/     → Daily: what was fetched, any data quality issues found
```

**analyst workspace:**
```
SOUL.md     → "You analyze trade data. Confident, opinionated. No hedging."
AGENTS.md   → Analysis framework, output format
TOOLS.md    → Notes: "IV rank >80 = high conviction signal"
MEMORY.md   → "Last 3 AAPL analyses: bullish bias confirmed each time."
memory/     → Daily: analyses done, accuracy tracking
```

**recorder workspace:**
```
SOUL.md     → "You log trades and analysis to files. Precise formatting."
AGENTS.md   → File format specs, directory conventions
TOOLS.md    → Notes: "Portfolio dir is ~/clawd/pipeline-outputs/"
MEMORY.md   → "Use markdown tables. Include timestamps."
memory/     → Daily: what was logged, where
```

---

## Resolved: Orchestrator Autonomy

**Decision: Start conservative. Pre-defined specialists only. Leave extension points.**

### Phase 1: Pre-defined Specialists (NOW)

The orchestrator can only delegate to agents that already exist in `agents.list` and are in its `subagents.allowAgents` list.

```json5
{
  id: "orchestrator",
  subagents: {
    allowAgents: ["market-data", "analyst", "recorder"]
  }
}
```

It cannot:
- Create new agents
- Modify agent SOUL.md files
- Change agent configurations
- Spawn agents not in its allowlist

### Phase 2: Extensible Specialist Registry (FUTURE)

When the number of specialists grows beyond 3-5, add:

1. **Agent catalog file** in orchestrator workspace:
   ```markdown
   # AGENTS-CATALOG.md
   
   ## Available Specialists
   
   ### market-data
   - **When to use:** Fetching prices, options chains, volume data
   - **Strengths:** Web scraping, API calls, structured output
   - **Model:** Sonnet (fast)
   
   ### analyst
   - **When to use:** Interpreting data, finding patterns, making calls
   - **Strengths:** Deep reasoning, historical comparison
   - **Model:** Opus (thorough)
   
   ### recorder
   - **When to use:** Logging results to files, formatting output
   - **Strengths:** Precise formatting, file management
   - **Model:** Sonnet (fast)
   ```

2. **New specialist request flow:** Orchestrator can REQUEST a new specialist by writing a proposal to a file. Human reviews and creates it. No autonomous agent creation.

### Phase 3: Dynamic Specialist Creation (FAR FUTURE)

Only after trust is established. The orchestrator could:
- Write a SOUL.md for a new specialist
- Submit it for human approval
- Human runs `openclaw agents add <name>` and restarts

This is explicitly not in scope for now. We're documenting it so the architecture doesn't block it later.

---

## Resolved: Cost Tracking

**Decision: Track per-agent, surface in OpenKanban.**

### How OpenClaw Already Tracks

Every `sessions_spawn` creates a session keyed as `agent:<agentId>:subagent:<uuid>`. OpenClaw tracks per-session:
- Token count (input + output)
- Model used
- Estimated cost (when API key auth)
- Runtime duration

The `agentId` is embedded in the session key, so we can aggregate by agent.

### What OpenKanban Needs to Do

1. **Per-step cost in pipeline view:** After each step completes, fetch session stats and display alongside the output.

2. **Per-agent cost aggregation:** New API endpoint `GET /api/agents/usage` that:
   - Calls `sessions_list` with `kinds: ["other"]` (sub-agent sessions)
   - Groups by agentId (parsed from session key: `agent:<agentId>:subagent:*`)
   - Sums tokens and estimated cost per agent
   - Returns: `{ "market-data": { tokens: 12400, cost: "$0.02", runs: 5 }, ... }`

3. **Dashboard widget:** "Agent Usage" card showing:
   - Per-agent token usage (bar chart)
   - Per-agent run count
   - Cost breakdown by model tier (Sonnet vs Opus)

4. **Pipeline run cost:** Each `workflow_run` row gets a `total_tokens` and `estimated_cost` column, populated when run completes.

### Implementation Detail

```typescript
// In workflow-engine.ts, after extractSessionOutput:
async function extractSessionCost(sessionKey: string): Promise<{tokens: number, cost?: string}> {
  const sessions = await client.listSessions({ messageLimit: 0 });
  const session = sessions.find(s => s.key === sessionKey);
  return {
    tokens: session?.totalTokens ?? 0,
    cost: session?.estimatedCost
  };
}
```

---

## Gateway Config (Complete)

```json5
{
  agents: {
    defaults: {
      // ... existing defaults ...
      subagents: {
        maxConcurrent: 8
      }
    },
    list: [
      {
        id: "main",
        default: true,
        workspace: "/home/molt/clawd",
        model: "anthropic/claude-opus-4-6",
        subagents: {
          allowAgents: ["market-data", "analyst", "recorder"]
        }
      },
      {
        id: "market-data",
        workspace: "~/.openclaw/workspace-market-data",
        model: "anthropic/claude-sonnet-4-6",
        tools: {
          allow: ["web_fetch", "web_search", "browser", "exec", "read", "Write",
                  "memory_search", "memory_store", "memory_get"],
          deny: ["cron", "gateway", "message", "sessions_spawn", "sessions_send"]
        }
      },
      {
        id: "analyst",
        workspace: "~/.openclaw/workspace-analyst",
        model: "anthropic/claude-opus-4-6",
        tools: {
          allow: ["read", "web_search", "web_fetch",
                  "memory_search", "memory_store", "memory_get"],
          deny: ["exec", "browser", "Write", "edit", "cron", "gateway",
                 "sessions_spawn", "sessions_send"]
        }
      },
      {
        id: "recorder",
        workspace: "~/.openclaw/workspace-recorder",
        model: "anthropic/claude-sonnet-4-6",
        tools: {
          allow: ["read", "Write", "edit", "exec",
                  "memory_search", "memory_store", "memory_get"],
          deny: ["browser", "web_fetch", "web_search", "cron", "gateway",
                 "sessions_spawn", "sessions_send"]
        }
      }
    ]
  }
}
```

**Note:** All specialists get `memory_search`, `memory_store`, `memory_get` — they participate in the shared Mem0 knowledge pool. None get `sessions_spawn` or session tools (they can't delegate work — only the orchestrator/main agent can).

---

## OpenKanban Integration (Minimal Code Change)

### Database Schema Change

```sql
-- Add agentId to workflow template steps
ALTER TABLE workflow_template_steps ADD COLUMN agent_id TEXT;

-- Add cost tracking to runs
ALTER TABLE workflow_runs ADD COLUMN total_tokens INTEGER DEFAULT 0;
ALTER TABLE workflow_runs ADD COLUMN estimated_cost TEXT;

-- Add cost tracking to step results  
ALTER TABLE task_deliverables ADD COLUMN tokens INTEGER DEFAULT 0;
```

### Template Step Schema

```typescript
interface WorkflowStep {
  name: string;
  agent_role: string;        // existing: fallback description
  agentId?: string;          // NEW: OpenClaw agent ID
  model?: string;            // optional model override
  review?: boolean;
  dependencies?: number[];
}
```

### Engine Change (~5 lines)

```typescript
// In executeNextStep, modify the spawn call:
const result = await client.spawnSession({
  task: buildStepPrompt(step, run, previousOutputs),
  label: `wf-${runId}-step${step.order}`,
  agentId: step.agentId || undefined,     // ← NEW: one line
  model: step.model || undefined,
  cleanup: 'keep',
  runTimeoutSeconds: 300,
});
```

### UI Changes

1. **Step card badge:** Show agent name/emoji next to step name in pipeline view
2. **Agent selector in template editor:** Dropdown listing available agents (from `GET /api/openclaw/agents`)
3. **Cost display:** Token count + estimated cost per step and per run

---

## Implementation Plan

### Step 1: Create Agent Workspaces (30 min)
```bash
# Create workspace directories
mkdir -p ~/.openclaw/workspace-market-data/memory
mkdir -p ~/.openclaw/workspace-analyst/memory
mkdir -p ~/.openclaw/workspace-recorder/memory

# Write SOUL.md, AGENTS.md for each (see below)

# Create agent state directories
mkdir -p ~/.openclaw/agents/market-data/agent
mkdir -p ~/.openclaw/agents/analyst/agent
mkdir -p ~/.openclaw/agents/recorder/agent

# Copy auth
cp ~/.openclaw/agents/main/agent/auth-profiles.json ~/.openclaw/agents/market-data/agent/
cp ~/.openclaw/agents/main/agent/auth-profiles.json ~/.openclaw/agents/analyst/agent/
cp ~/.openclaw/agents/main/agent/auth-profiles.json ~/.openclaw/agents/recorder/agent/
```

### Step 2: Update Gateway Config (10 min)
- Add specialist agents to `agents.list`
- Set `subagents.allowAgents` on main agent
- Restart gateway

### Step 3: Update OpenKanban (1-2 hours)
- Schema migration: add `agent_id` column
- Template step editor: add agent dropdown
- `executeNextStep`: pass `agentId` to spawn
- Cost tracking: extract and display per-step tokens
- Update seeded templates with agent assignments

### Step 4: Test E2E (30 min)
- Trigger "Trade Idea Analysis" pipeline
- Verify market-data agent fetches (uses web tools)
- Verify analyst agent analyzes (uses Opus, read-only)
- Verify recorder agent logs (writes files)
- Check Mem0 — shared facts from all agents visible

---

## SOUL.md Templates

### market-data/SOUL.md
```markdown
# Market Data Specialist

You pull financial data. That's your entire job.

## What You Do
- Fetch options chains, stock prices, volume data, market news
- Use Yahoo Finance, Polygon.io, web scraping when APIs aren't enough
- Return structured data: tables, numbers, dates, sources
- Flag data quality issues: stale timestamps, missing fields, suspicious values
- Note when data sources change layout or API format (store in memory for next time)

## What You DON'T Do
- Analyze or interpret the data
- Make trading recommendations or express opinions
- Write prose, commentary, or disclaimers
- Access systems outside financial data sources

## Output Format
Always return structured markdown:
- **Underlying:** ticker, price, change, timestamp
- **Options chain:** strikes, bids/asks, volume, OI, IV, Greeks (table format)
- **Volume analysis:** unusual activity, block trades when visible
- **Data quality:** freshness timestamp, source URL, any caveats
- **Memory notes:** anything unusual you'd want to know next time (store via memory_store)

## Working Style
- Fast. Get the data and return it. No preamble.
- If a source is down, try alternatives before reporting failure.
- Include raw numbers. Let the analyst interpret them.
```

### analyst/SOUL.md
```markdown
# Trade Analyst

You analyze financial data and produce actionable trade analysis.

## What You Do
- Interpret options flow, price action, volume patterns
- Identify directional bias: bullish, bearish, or neutral (with conviction level)
- Assess risk/reward for potential positions
- Compare current data to historical patterns (check memory for past analyses)
- Provide clear, confident analysis with reasoning
- Track your accuracy over time (note predictions in memory)

## What You DON'T Do
- Fetch raw data (the data agent does that — you receive it as input)
- Execute trades or manage portfolios
- Hedge with excessive disclaimers ("it depends," "many factors," "not financial advice")
- Use filler or corporate speak

## Analysis Framework
1. **Directional Bias** — bullish/bearish/neutral + conviction (low/medium/high)
2. **Key Levels** — support, resistance, gamma exposure pins
3. **Volatility** — IV rank, IV vs HV spread, skew
4. **Catalysts** — earnings, events, macro, sector rotation
5. **Risk Scenarios** — bull case, bear case, base case with targets
6. **Trade Ideas** — specific entries, exits, position sizing context

## Memory
You compound knowledge. Use memory to:
- Reference past analyses: "Last time AAPL IV was this low, it rallied 8%"
- Track pattern accuracy: "Called 3 out of 4 TSLA direction moves correctly"
- Note market regime shifts: "Moved from risk-off to risk-on Feb 2026"

## Voice
Confident but honest. Say "I'm 70% bullish" not "there are various factors to consider." Wrong with conviction is more useful than right with hesitation.
```

### recorder/SOUL.md
```markdown
# Portfolio Recorder

You log analysis results and trade data to files. Clean, precise, consistent.

## What You Do
- Write pipeline outputs to structured markdown files
- Format trade analyses, market data, and decisions into clean documents
- Maintain consistent file naming and directory structure
- Include metadata: timestamps, sources, pipeline context

## What You DON'T Do
- Fetch data or browse the web
- Analyze or interpret results
- Modify existing files unless explicitly told to update them
- Create files outside the designated output directory

## Output Format
Every file you write:
- **Header:** Pipeline name, run timestamp, trigger context
- **Body:** Content from previous pipeline steps, cleanly formatted
- **Footer:** Agent versions/models used, token counts if available
- Use markdown tables for structured data
- Use headers (##) for sections
- Include the raw source step name for each section

## File Naming
`{output-dir}/{template-slug}/{YYYYMMDD}_{HHMMSS}_{trigger-slug}.md`

## Working Style
- Precision over creativity. You're a filing system, not an author.
- If formatting is ambiguous, choose the cleaner option.
- Always confirm the file path in your response.
```

---

## Future Enhancements (Not In Scope Now)

### 1. Orchestrator Agent (Phase 2)
A special agent that receives missions and dynamically decides which specialists to deploy. Replaces rigid template steps with adaptive delegation. Requires:
- Own SOUL.md describing team coordination
- `sessions_spawn` access to all specialists
- OpenKanban tracking of its spawn decisions as dynamic pipeline steps

### 2. Mem0 Metadata Tagging
Add `source_agent` metadata to `memory_store` calls. Enables per-agent memory filtering if noise becomes a problem:
```typescript
memory_store({ text: "...", metadata: { source_agent: "market-data" } })
// Later: memory_search({ query: "...", filters: { source_agent: "analyst" } })
```

### 3. Agent Performance Dashboard
Track per-agent metrics over time:
- Success rate (how often agent output leads to approved results)
- Average tokens per task
- Average runtime
- Cost per agent per day/week

### 4. Memory Consolidation
Periodic task (heartbeat or cron) that:
- Reviews each agent's `memory/` daily notes
- Promotes durable learnings to agent's `MEMORY.md`
- Cross-pollinates: if the analyst discovers something the data agent should know, surface it

### 5. Dynamic Specialist Templates
When the orchestrator requests a new specialist type, a human-reviewed flow:
- Orchestrator writes proposed SOUL.md to a staging directory
- OpenKanban shows "New Agent Request" in approvals
- Human approves → system creates workspace + config entry + restarts gateway

### 6. Per-Agent Mem0 Scoping (if needed)
If shared Mem0 causes real noise problems:
- Option A: Use `userId` per agent (`"market-data"`, `"analyst"`) — full isolation
- Option B: Use Mem0 metadata filtering — isolation with cross-agent search capability
- Option C: Keep shared userId but add category-based filtering

Currently unnecessary. The semantic search threshold handles cross-role noise well enough.

---

## Review & Analysis

### What We're Building vs What Exists

| Capability | OpenClaw Native | Our Addition |
|---|---|---|
| Isolated workspaces | ✅ per-agent workspace | Write SOUL.md content |
| Tool restrictions | ✅ allow/deny per agent | Define per-specialist lists |
| Model selection | ✅ per-agent model | Choose Sonnet vs Opus per role |
| Memory | ✅ workspace files + Mem0 | Write initial MEMORY.md per agent |
| Session isolation | ✅ per-agent sessions | Nothing — it works |
| Auth | ✅ per-agent auth-profiles | Copy from main (shared) |
| Cost tracking | ✅ per-session tokens | Aggregate by agentId in UI |
| Sub-agent spawning | ✅ sessions_spawn + agentId | Pass agentId from template step |

**Of the 8 capabilities we need, 8 already exist in OpenClaw.** Our work is configuration + glue, not new infrastructure.

### Hypotheses

1. **Shared Mem0 won't cause noise problems.** The semantic search threshold (0.3) + topK (5) + query relevance means an analyst asking about "AAPL options analysis" won't get recorder memories about "file naming conventions." If this hypothesis fails, we have the metadata tagging escape hatch.

2. **Specialists will develop useful memories over time.** After 20 analyst runs, the analyst's MEMORY.md should contain patterns like "AAPL pre-earnings IV typically inflates to 40% rank." This makes each subsequent analysis better. If specialists' memory files stay empty, the architecture is over-engineered for the use case.

3. **Opus for analysis is worth the cost premium.** The analyst needs deep reasoning — pattern recognition, historical comparison, conviction formation. If Sonnet produces equally good analysis, we can downgrade later and save money. Start with the better model and prove it's needed.

4. **Three specialists is the right starting number.** Data → Analysis → Recording covers the entire trade idea pipeline. If we find ourselves repeatedly adding ad-hoc steps ("sentiment analysis," "news scanning"), that's a signal to add a 4th specialist. Don't add one preemptively.

5. **Template-driven orchestration is sufficient for Phase 1.** Hans has 3-5 workflow types. Rigid step sequences work fine for that scale. The orchestrator pattern (Phase 2) only becomes necessary when: (a) the number of templates exceeds ~15, or (b) Hans starts requesting novel workflows faster than we can template them.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Auth-profiles.json gets out of sync after key rotation | Medium | High (agents fail silently) | Sync script + heartbeat check |
| Specialists' workspace files never get updated (stale MEMORY.md) | Medium | Low (they just don't compound) | Memory consolidation cron (Future #4) |
| Opus cost for analyst is too high for frequent use | Low | Medium | Model override per template step |
| Mem0 auto-capture creates noise from specialist sessions | Low | Low | Metadata tagging (Future #2) |
| OpenClaw doesn't support `agentId` on `sessions_spawn` for sub-agent-of-sub-agent | N/A | N/A | Confirmed supported in docs |

### Conclusion

**This is a configuration project, not a coding project.** The heavy lift is writing good SOUL.md files for each specialist and choosing the right tool restrictions. The actual code changes to OpenKanban are ~20 lines (schema migration + passing agentId to spawn). The gateway config change is ~40 lines.

**Start with 3 agents. Shared auth. Hybrid memory. Conservative orchestrator.** Every decision is reversible:
- Shared → separate auth: copy different keys into agentDir
- Shared → isolated Mem0: change userId per agent in config
- Conservative → dynamic orchestrator: add orchestrator agent with spawn access
- 3 agents → N agents: create workspace + add to config

**The architecture explicitly doesn't block future expansion.** Every "future enhancement" listed above requires zero changes to the foundation we're building now.
