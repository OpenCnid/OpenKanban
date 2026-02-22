#!/bin/bash
# OpenKanban Comprehensive Test Suite
# Tests all APIs end-to-end from empty DB through full lifecycle

BASE="http://localhost:4000"
PASS=0
FAIL=0
TOTAL=0

test_eq() {
  TOTAL=$((TOTAL + 1))
  local desc="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc"
    echo "     expected: $expected"
    echo "     actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

test_contains() {
  TOTAL=$((TOTAL + 1))
  local desc="$1" actual="$2" expected="$3"
  if echo "$actual" | grep -qF "$expected"; then
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc (expected to contain: $expected)"
    echo "     actual: ${actual:0:200}"
    FAIL=$((FAIL + 1))
  fi
}

test_status() {
  TOTAL=$((TOTAL + 1))
  local desc="$1" method="$2" url="$3" expected="$4" body="$5"
  local code
  if [ -n "$body" ]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$url" -H 'Content-Type: application/json' -d "$body")
  else
    code=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$url")
  fi
  if [ "$code" = "$expected" ]; then
    echo "  ✅ $desc ($code)"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc (got $code, expected $expected)"
    FAIL=$((FAIL + 1))
  fi
}

pj() {
  python3 -c "import json,sys; $1" 2>/dev/null
}

echo "╔══════════════════════════════════════════════════════════╗"
echo "║        OPENKANBAN COMPREHENSIVE TEST SUITE              ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ═══════════════════════════════════════════════════
echo "━━━ 1. INFRASTRUCTURE ━━━"
# ═══════════════════════════════════════════════════

test_status "Server is running" GET "$BASE/" 200
test_status "OpenClaw status endpoint" GET "$BASE/api/openclaw/status" 200

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 2. WORKSPACES ━━━"
# ═══════════════════════════════════════════════════

R=$(curl -s "$BASE/api/workspaces?stats=true")
test_contains "List workspaces returns array" "$R" '"id"'

R=$(curl -s "$BASE/api/workspaces/default")
test_eq "Default workspace exists" "$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('name',''))")" "Default Workspace"

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 3. WORKFLOW TEMPLATES (CRUD) ━━━"
# ═══════════════════════════════════════════════════

# Seed
# Seed — response is { results: [...] }
R=$(curl -s -X POST "$BASE/api/workflows/seed" -H 'Content-Type: application/json' -d '{}')
SEED_COUNT=$(echo "$R" | pj "
r=json.load(sys.stdin)
results = r.get('results', r) if isinstance(r, dict) else r
if isinstance(results, list):
    print(len([x for x in results if x.get('action')=='created']))
else:
    print(0)
")
test_eq "Seed creates 3 templates" "$SEED_COUNT" "3"

# List
R=$(curl -s "$BASE/api/workflows?workspace_id=default")
TEMPLATE_COUNT=$(echo "$R" | pj "r=json.load(sys.stdin); print(len(r))")
test_eq "List returns 3 templates" "$TEMPLATE_COUNT" "3"

# Get by ID
TID_TRADE=$(echo "$R" | pj "r=json.load(sys.stdin); t=[x for x in r if x['name']=='Trade Idea Analysis']; print(t[0]['id'])")
TID_YT=$(echo "$R" | pj "r=json.load(sys.stdin); t=[x for x in r if x['name']=='YouTube to Presentation']; print(t[0]['id'])")
TID_WED=$(echo "$R" | pj "r=json.load(sys.stdin); t=[x for x in r if 'Wednesday' in x['name']]; print(t[0]['id'])")

R=$(curl -s "$BASE/api/workflows/$TID_TRADE")
test_eq "Get template by ID" "$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('name',''))")" "Trade Idea Analysis"

# Create custom — steps is a JSON array
R=$(curl -s -X POST "$BASE/api/workflows" -H 'Content-Type: application/json' -d '{
  "name": "Test Workflow",
  "description": "For testing",
  "steps": [{"name":"Step 1","agent_role":"tester"}],
  "workspace_id": "default",
  "trigger_type": "manual"
}')
TID_CUSTOM=$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('id',''))")
test_contains "Create custom template" "$R" '"id"'

# Update — use the route.ts [id] endpoint
if [ -n "$TID_CUSTOM" ] && [ "$TID_CUSTOM" != "None" ]; then
  R=$(curl -s -X PATCH "$BASE/api/workflows/$TID_CUSTOM" -H 'Content-Type: application/json' -d '{"description":"Updated description"}')
  test_contains "Update template" "$R" "Updated description"

  # Verify update
  R=$(curl -s "$BASE/api/workflows/$TID_CUSTOM")
  test_eq "Update persisted" "$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('description',''))")" "Updated description"
else
  echo "  ⏭️  Update/verify skipped (create failed)"
fi

# Idempotent seed
R=$(curl -s -X POST "$BASE/api/workflows/seed" -H 'Content-Type: application/json' -d '{}')
SKIP_COUNT=$(echo "$R" | pj "
r=json.load(sys.stdin)
results = r.get('results', r) if isinstance(r, dict) else r
if isinstance(results, list):
    print(len([x for x in results if x.get('action') in ('exists','skipped')]))
else:
    print(0)
")
test_eq "Seed is idempotent (3 skipped)" "$SKIP_COUNT" "3"

# Delete
if [ -n "$TID_CUSTOM" ] && [ "$TID_CUSTOM" != "None" ]; then
  test_status "Delete custom template" DELETE "$BASE/api/workflows/$TID_CUSTOM" 200
else
  echo "  ⏭️  Delete skipped (create failed)"
fi

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 4. WORKFLOW RUNS (Execution Lifecycle) ━━━"
# ═══════════════════════════════════════════════════

# Create a run
R=$(curl -s -X POST "$BASE/api/workflows/$TID_TRADE/run" -H 'Content-Type: application/json' -d '{
  "trigger_input": "Analyze AAPL earnings",
  "trigger_method": "test",
  "auto_execute": false
}')
RUN_ID=$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('id',''))")
test_contains "Create workflow run" "$R" '"id"'

# List runs
R=$(curl -s "$BASE/api/workflows/runs?workspace_id=default")
RUN_COUNT=$(echo "$R" | pj "r=json.load(sys.stdin); print(len(r))")
test_eq "List runs returns 1" "$RUN_COUNT" "1"

# Get specific run
R=$(curl -s "$BASE/api/workflows/runs/$RUN_ID")
test_eq "Get run status" "$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('status',''))")" "running"

# Cancel run
R=$(curl -s -X POST "$BASE/api/workflows/runs/$RUN_ID/cancel")
test_contains "Cancel run" "$R" "cancelled"

# Verify cancelled
R=$(curl -s "$BASE/api/workflows/runs/$RUN_ID")
test_eq "Run is cancelled" "$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('status',''))")" "cancelled"

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 5. AGENT-INITIATED TRIGGER ━━━"
# ═══════════════════════════════════════════════════

# Mode 1: Direct trigger
R=$(curl -s -X POST "$BASE/api/workflows/trigger" -H 'Content-Type: application/json' -d "{
  \"template_id\": \"$TID_TRADE\",
  \"input\": \"AAPL unusual put volume\",
  \"source\": \"triage\"
}")
test_eq "Direct trigger" "$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('action',''))")" "triggered"

# Mode 2: Routed (low confidence → needs_review)
R=$(curl -s -X POST "$BASE/api/workflows/trigger" -H 'Content-Type: application/json' -d '{
  "input": "something vague",
  "source": "triage"
}')
ACTION=$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('action',''))")
# Low confidence falls through to needs_review (keyword fallback without LLM)
test_contains "Routed trigger creates action" "$ACTION" "review"

# Mode 3: Propose only
R=$(curl -s -X POST "$BASE/api/workflows/trigger" -H 'Content-Type: application/json' -d '{
  "input": "quarterly report prep",
  "source": "market-scanner",
  "propose_only": true
}')
test_eq "Propose only" "$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('action',''))")" "proposed"
NOTIF_ID=$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('notification_id',''))")
test_contains "Propose creates notification" "$NOTIF_ID" "-"

# Validation
test_status "Trigger without input returns 400" POST "$BASE/api/workflows/trigger" 400 '{}'

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 6. SEMANTIC ROUTER ━━━"
# ═══════════════════════════════════════════════════

R=$(curl -s -X POST "$BASE/api/workflows/route-input" -H 'Content-Type: application/json' -d '{
  "input": "analyze trade for TSLA",
  "workspace_id": "default"
}')
test_contains "Router returns path" "$R" '"path"'
test_contains "Router returns confidence" "$R" '"confidence"'

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 7. APPROVALS ━━━"
# ═══════════════════════════════════════════════════

R=$(curl -s "$BASE/api/approvals?workspace_id=default")
test_status "List approvals" GET "$BASE/api/approvals?workspace_id=default" 200

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 8. WORKFLOW INTELLIGENCE ━━━"
# ═══════════════════════════════════════════════════

R=$(curl -s "$BASE/api/workflows/health?workspace_id=default")
test_status "Health endpoint" GET "$BASE/api/workflows/health?workspace_id=default" 200
test_contains "Health returns array" "$R" "["

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 9. SCHEDULE TRIGGERS (Cron) ━━━"
# ═══════════════════════════════════════════════════

# Create schedule (requires OpenClaw cron tool)
R=$(curl -s --max-time 15 -X POST "$BASE/api/workflows/$TID_WED/schedule" -H 'Content-Type: application/json' -d '{
  "schedule": "0 9 * * 3",
  "timezone": "America/Chicago"
}')
SCHED_STATUS=$(echo "$R" | pj "r=json.load(sys.stdin); print('ok' if r.get('cronJobId') or r.get('cron_job_id') or r.get('success') else 'fail')" || echo "timeout")
if [ "$SCHED_STATUS" = "timeout" ]; then
  echo "  ⏭️  Schedule tests skipped (OpenClaw cron unavailable)"
else
  if [ "$SCHED_STATUS" = "ok" ]; then
    test_eq "Create schedule" "$SCHED_STATUS" "ok"
    R=$(curl -s "$BASE/api/workflows/$TID_WED/schedule")
    test_contains "Get schedule" "$R" "cron"
    test_status "Delete schedule" DELETE "$BASE/api/workflows/$TID_WED/schedule" 200
  else
    echo "  ⏭️  Schedule CRUD skipped (OpenClaw cron tool not responding)"
  fi
fi

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 10. NOTIFICATIONS ━━━"
# ═══════════════════════════════════════════════════

R=$(curl -s "$BASE/api/notifications")
NOTIF_COUNT=$(echo "$R" | pj "r=json.load(sys.stdin); print(len(r.get('notifications',[])))")
UNREAD=$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('unreadCount',0))")
test_eq "Notifications created from triggers" "$(python3 -c "print('yes' if int('$NOTIF_COUNT') >= 2 else 'no')")" "yes"
test_eq "Has unread notifications" "$(python3 -c "print('yes' if int('$UNREAD') >= 1 else 'no')")" "yes"

# Get first notification ID
NID=$(echo "$R" | pj "r=json.load(sys.stdin); print(r['notifications'][0]['id'])")

# Mark read
R=$(curl -s -X PATCH "$BASE/api/notifications/$NID" -H 'Content-Type: application/json' -d '{"read":true}')
test_eq "Mark notification read" "$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('success',''))")" "True"

# Verify unread decreased
R=$(curl -s "$BASE/api/notifications")
NEW_UNREAD=$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('unreadCount',0))")
test_eq "Unread count decreased" "$(python3 -c "print('yes' if int('$NEW_UNREAD') < int('$UNREAD') else 'no')")" "yes"

# Mark all read
R=$(curl -s -X POST "$BASE/api/notifications/read-all")
test_eq "Mark all read" "$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('success',''))")" "True"

R=$(curl -s "$BASE/api/notifications")
test_eq "All marked read" "$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('unreadCount',0))")" "0"

# Delete
R=$(curl -s -X DELETE "$BASE/api/notifications/$NID")
test_eq "Delete notification" "$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('success',''))")" "True"

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 11. GLOBAL SEARCH ━━━"
# ═══════════════════════════════════════════════════

# Search workflows
R=$(curl -s "$BASE/api/search?q=trade")
test_contains "Search finds Trade workflow" "$R" "Trade Idea Analysis"

R=$(curl -s "$BASE/api/search?q=youtube")
test_contains "Search finds YouTube workflow" "$R" "YouTube to Presentation"

# Empty search
R=$(curl -s "$BASE/api/search?q=xyznonexistent999")
TOTAL_RESULTS=$(echo "$R" | pj "
r=json.load(sys.stdin)
t=sum(len(r.get(k,[])) for k in ['workflows','tasks','memories','approvals'])
print(t)
")
test_eq "Empty search returns 0 results" "$TOTAL_RESULTS" "0"

# Validation
test_status "Search requires 2+ chars" GET "$BASE/api/search?q=a" 400
test_status "Search requires query" GET "$BASE/api/search" 400

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 12. MEMORY API ━━━"
# ═══════════════════════════════════════════════════

R=$(curl -s "$BASE/api/memory")
test_contains "List memories returns array" "$R" "["

R=$(curl -s "$BASE/api/memory?q=test&scope=all")
test_contains "Search memories returns array" "$R" "["

# Store
R=$(curl -s -X POST "$BASE/api/memory" -H 'Content-Type: application/json' -d '{"text":"Test memory from suite","longTerm":true}')
test_status "Store memory" POST "$BASE/api/memory" 200 '{"text":"Another test memory"}'

# Validation
test_status "Store requires text" POST "$BASE/api/memory" 400 '{}'
test_status "Delete requires params" DELETE "$BASE/api/memory" 400 '{}'

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 13. CHAT API ━━━"
# ═══════════════════════════════════════════════════

# Send message (may timeout if OpenClaw is slow, that's ok)
R=$(curl -s --max-time 10 -X POST "$BASE/api/chat" -H 'Content-Type: application/json' -d '{"message":"hello"}')
test_contains "Chat returns response" "$R" '"response"'

# Validation
test_status "Chat requires message" POST "$BASE/api/chat" 400 '{}'
test_status "Chat rejects empty message" POST "$BASE/api/chat" 400 '{"message":""}'
test_status "Chat rejects whitespace" POST "$BASE/api/chat" 400 '{"message":"   "}'

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 14. TASKS (Upstream) ━━━"
# ═══════════════════════════════════════════════════

R=$(curl -s "$BASE/api/tasks?workspace_id=default")
test_contains "List tasks returns array" "$R" "["

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 15. AGENTS (Upstream) ━━━"
# ═══════════════════════════════════════════════════

test_status "List agents" GET "$BASE/api/agents?workspace_id=default" 200

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 16. EVENTS / SSE ━━━"
# ═══════════════════════════════════════════════════

test_status "Events list" GET "$BASE/api/events" 200

# SSE stream check — skip in automated testing (blocks)
echo "  ⏭️  SSE stream test skipped (requires async client)"

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 17. ALERTS WEBHOOK ━━━"
# ═══════════════════════════════════════════════════

R=$(curl -s -X POST "$BASE/api/alerts" -H 'Content-Type: application/json' -d '{
  "source": "test-suite",
  "title": "Test alert",
  "message": "Automated test",
  "severity": "info"
}')
test_contains "Create alert" "$R" '"id"'
ALERT_ID=$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('id',''))")

R=$(curl -s "$BASE/api/alerts")
test_contains "List alerts" "$R" "test-suite"

if [ -n "$ALERT_ID" ]; then
  test_status "Acknowledge alert" PATCH "$BASE/api/alerts/$ALERT_ID" 200 '{"acknowledged":true}'
fi

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 18. PAGES RENDER ━━━"
# ═══════════════════════════════════════════════════

test_status "Home page" GET "$BASE/" 200
test_status "Workspace page" GET "$BASE/workspace/default" 200
test_status "Workspace with tab" GET "$BASE/workspace/default?tab=pipelines" 200
test_status "Settings page" GET "$BASE/settings" 200
test_status "404 workspace" GET "$BASE/workspace/nonexistent-xyz" 200  # Next.js renders 200 with "not found" content

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 19. INPUT VALIDATION & EDGE CASES ━━━"
# ═══════════════════════════════════════════════════

# Missing workspace_id defaults gracefully
R=$(curl -s "$BASE/api/workflows")
test_contains "Workflows without workspace_id" "$R" "["

# Invalid JSON
test_status "Invalid JSON body" POST "$BASE/api/workflows/trigger" 500 'not json'

# XSS in search (should not break)
R=$(curl -s "$BASE/api/search?q=%3Cscript%3Ealert(1)%3C/script%3E")
test_status "XSS in search query" GET "$BASE/api/search?q=%3Cscript%3Ealert(1)%3C/script%3E" 200

# Very long query
LONG_Q=$(python3 -c "print('a'*500)")
test_status "Long search query" GET "$BASE/api/search?q=$LONG_Q" 200

# SQL injection attempt in search
test_status "SQL injection in search" GET "$BASE/api/search?q=';DROP%20TABLE%20tasks;--" 200

# ═══════════════════════════════════════════════════
echo ""
echo "━━━ 20. FULL LIFECYCLE (End-to-End) ━━━"
# ═══════════════════════════════════════════════════

echo "  Running: Trigger → Run → Steps → Cancel lifecycle..."

# 1. Trigger via agent
R=$(curl -s -X POST "$BASE/api/workflows/trigger" -H 'Content-Type: application/json' -d "{
  \"template_id\": \"$TID_YT\",
  \"input\": \"https://youtube.com/watch?v=test123\",
  \"source\": \"triage\"
}")
E2E_RUN_ID=$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('run_id',''))")
test_contains "E2E: Trigger creates run" "$E2E_RUN_ID" "-"

# 2. Verify run exists
R=$(curl -s "$BASE/api/workflows/runs/$E2E_RUN_ID")
test_eq "E2E: Run is running" "$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('status',''))")" "running"
test_eq "E2E: Template is YouTube" "$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('name',''))")" "YouTube to Presentation"

# 3. Verify notification was NOT created (direct trigger = no notification)
# (Propose-only and low-confidence create notifications, direct triggers don't)

# 4. Cancel the run
R=$(curl -s -X POST "$BASE/api/workflows/runs/$E2E_RUN_ID/cancel")
test_contains "E2E: Cancel succeeds" "$R" "cancelled"

# 5. Verify final state
R=$(curl -s "$BASE/api/workflows/runs/$E2E_RUN_ID")
test_eq "E2E: Run is cancelled" "$(echo "$R" | pj "r=json.load(sys.stdin); print(r.get('status',''))")" "cancelled"

# 6. Search finds the workflow that was just used
R=$(curl -s "$BASE/api/search?q=youtube")
test_contains "E2E: Search finds YouTube template" "$R" "YouTube"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  RESULTS: $PASS passed, $FAIL failed out of $TOTAL tests  "
echo "╚══════════════════════════════════════════════════════════╝"

if [ "$FAIL" -eq 0 ]; then
  echo ""
  echo "  🎉 ALL TESTS PASSED"
else
  echo ""
  echo "  ⚠️  $FAIL FAILURES — review above"
fi
