/**
 * Database Migrations System
 * 
 * Handles schema changes in a production-safe way:
 * 1. Tracks which migrations have been applied
 * 2. Runs new migrations automatically on startup
 * 3. Never runs the same migration twice
 */

import Database from 'better-sqlite3';

interface Migration {
  id: string;
  name: string;
  up: (db: Database.Database) => void;
}

// All migrations in order - NEVER remove or reorder existing migrations
const migrations: Migration[] = [
  {
    id: '001',
    name: 'initial_schema',
    up: (db) => {
      // Core tables - these are created in schema.ts on fresh databases
      // This migration exists to mark the baseline for existing databases
      console.log('[Migration 001] Baseline schema marker');
    }
  },
  {
    id: '002',
    name: 'add_workspaces',
    up: (db) => {
      console.log('[Migration 002] Adding workspaces table and columns...');
      
      // Create workspaces table if not exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          description TEXT,
          icon TEXT DEFAULT '📁',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `);
      
      // Insert default workspace if not exists
      db.exec(`
        INSERT OR IGNORE INTO workspaces (id, name, slug, description, icon) 
        VALUES ('default', 'Default Workspace', 'default', 'Default workspace', '🏠');
      `);
      
      // Add workspace_id to tasks if not exists
      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
      if (!tasksInfo.some(col => col.name === 'workspace_id')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id)`);
        console.log('[Migration 002] Added workspace_id to tasks');
      }
      
      // Add workspace_id to agents if not exists
      const agentsInfo = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
      if (!agentsInfo.some(col => col.name === 'workspace_id')) {
        db.exec(`ALTER TABLE agents ADD COLUMN workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id)`);
        console.log('[Migration 002] Added workspace_id to agents');
      }
    }
  },
  {
    id: '003',
    name: 'add_planning_tables',
    up: (db) => {
      console.log('[Migration 003] Adding planning tables...');
      
      // Create planning_questions table if not exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS planning_questions (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          question TEXT NOT NULL,
          question_type TEXT DEFAULT 'multiple_choice' CHECK (question_type IN ('multiple_choice', 'text', 'yes_no')),
          options TEXT,
          answer TEXT,
          answered_at TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
      
      // Create planning_specs table if not exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS planning_specs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
          spec_markdown TEXT NOT NULL,
          locked_at TEXT NOT NULL,
          locked_by TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
      
      // Create index
      db.exec(`CREATE INDEX IF NOT EXISTS idx_planning_questions_task ON planning_questions(task_id, sort_order)`);
      
      // Update tasks status check constraint to include 'planning'
      // SQLite doesn't support ALTER CONSTRAINT, so we check if it's needed
      const taskSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as { sql: string } | undefined;
      if (taskSchema && !taskSchema.sql.includes("'planning'")) {
        console.log('[Migration 003] Note: tasks table needs planning status - will be handled by schema recreation on fresh dbs');
      }
    }
  },
  {
    id: '004',
    name: 'add_planning_session_columns',
    up: (db) => {
      console.log('[Migration 004] Adding planning session columns to tasks...');

      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];

      // Add planning_session_key column
      if (!tasksInfo.some(col => col.name === 'planning_session_key')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_session_key TEXT`);
        console.log('[Migration 004] Added planning_session_key');
      }

      // Add planning_messages column (stores JSON array of messages)
      if (!tasksInfo.some(col => col.name === 'planning_messages')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_messages TEXT`);
        console.log('[Migration 004] Added planning_messages');
      }

      // Add planning_complete column
      if (!tasksInfo.some(col => col.name === 'planning_complete')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_complete INTEGER DEFAULT 0`);
        console.log('[Migration 004] Added planning_complete');
      }

      // Add planning_spec column (stores final spec JSON)
      if (!tasksInfo.some(col => col.name === 'planning_spec')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_spec TEXT`);
        console.log('[Migration 004] Added planning_spec');
      }

      // Add planning_agents column (stores generated agents JSON)
      if (!tasksInfo.some(col => col.name === 'planning_agents')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_agents TEXT`);
        console.log('[Migration 004] Added planning_agents');
      }
    }
  },
  {
    id: '005',
    name: 'add_agent_model_field',
    up: (db) => {
      console.log('[Migration 005] Adding model field to agents...');

      const agentsInfo = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];

      // Add model column
      if (!agentsInfo.some(col => col.name === 'model')) {
        db.exec(`ALTER TABLE agents ADD COLUMN model TEXT`);
        console.log('[Migration 005] Added model to agents');
      }
    }
  },
  {
    id: '006',
    name: 'add_planning_dispatch_error_column',
    up: (db) => {
      console.log('[Migration 006] Adding planning_dispatch_error column to tasks...');

      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];

      // Add planning_dispatch_error column
      if (!tasksInfo.some(col => col.name === 'planning_dispatch_error')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN planning_dispatch_error TEXT`);
        console.log('[Migration 006] Added planning_dispatch_error to tasks');
      }
    }
  },
  {
    id: '007',
    name: 'add_agent_source_and_gateway_id',
    up: (db) => {
      console.log('[Migration 007] Adding source and gateway_agent_id to agents...');

      const agentsInfo = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];

      // Add source column: 'local' for MC-created, 'gateway' for imported from OpenClaw Gateway
      if (!agentsInfo.some(col => col.name === 'source')) {
        db.exec(`ALTER TABLE agents ADD COLUMN source TEXT DEFAULT 'local'`);
        console.log('[Migration 007] Added source to agents');
      }

      // Add gateway_agent_id column: stores the original agent ID/name from the Gateway
      if (!agentsInfo.some(col => col.name === 'gateway_agent_id')) {
        db.exec(`ALTER TABLE agents ADD COLUMN gateway_agent_id TEXT`);
        console.log('[Migration 007] Added gateway_agent_id to agents');
      }
    }
  },
  {
    id: '008',
    name: 'add_workflow_tables',
    up: (db) => {
      console.log('[Migration 008] Adding workflow tables...');

      // Workflow templates
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          trigger_type TEXT NOT NULL DEFAULT 'manual',
          trigger_config TEXT,
          steps TEXT NOT NULL,
          workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
          icon TEXT DEFAULT '⚡',
          enabled INTEGER DEFAULT 1,
          origin TEXT DEFAULT 'manual',
          status TEXT DEFAULT 'active',
          success_rate REAL,
          total_runs INTEGER DEFAULT 0,
          retrieval_count INTEGER DEFAULT 0,
          last_used_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `);

      // Workflow runs
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_runs (
          id TEXT PRIMARY KEY,
          template_id TEXT REFERENCES workflow_templates(id),
          name TEXT NOT NULL,
          status TEXT DEFAULT 'running',
          trigger_input TEXT,
          trigger_method TEXT,
          workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
          outcome TEXT,
          approval_count INTEGER DEFAULT 0,
          rejection_count INTEGER DEFAULT 0,
          duration_seconds INTEGER,
          started_at TEXT DEFAULT (datetime('now')),
          completed_at TEXT,
          metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_runs_status ON workflow_runs(status);
        CREATE INDEX IF NOT EXISTS idx_runs_template ON workflow_runs(template_id);
      `);

      // Task dependencies
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_dependencies (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          dependency_type TEXT DEFAULT 'finish_to_start',
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(task_id, depends_on_task_id)
        );
        CREATE INDEX IF NOT EXISTS idx_deps_task ON task_dependencies(task_id);
        CREATE INDEX IF NOT EXISTS idx_deps_depends ON task_dependencies(depends_on_task_id);
      `);

      // Approvals
      db.exec(`
        CREATE TABLE IF NOT EXISTS approvals (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          content TEXT,
          source TEXT,
          source_task_id TEXT REFERENCES tasks(id),
          workflow_run_id TEXT REFERENCES workflow_runs(id),
          status TEXT DEFAULT 'pending',
          resolved_at TEXT,
          resolution_notes TEXT,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
      `);

      // Notifications
      db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          message TEXT,
          link TEXT,
          read INTEGER DEFAULT 0,
          source_id TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(read, created_at DESC);
      `);

      // Alerts
      db.exec(`
        CREATE TABLE IF NOT EXISTS alerts (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          severity TEXT DEFAULT 'info',
          title TEXT NOT NULL,
          message TEXT,
          product TEXT,
          channel TEXT,
          acknowledged INTEGER DEFAULT 0,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity, acknowledged);
        CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
      `);

      // Add workflow columns to tasks table
      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];

      if (!tasksInfo.some(col => col.name === 'workflow_run_id')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN workflow_run_id TEXT REFERENCES workflow_runs(id)`);
        console.log('[Migration 008] Added workflow_run_id to tasks');
      }

      if (!tasksInfo.some(col => col.name === 'workflow_step_index')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN workflow_step_index INTEGER`);
        console.log('[Migration 008] Added workflow_step_index to tasks');
      }

      // Add workflow columns to task_deliverables table
      const deliverablesInfo = db.prepare("PRAGMA table_info(task_deliverables)").all() as { name: string }[];

      if (!deliverablesInfo.some(col => col.name === 'is_input')) {
        db.exec(`ALTER TABLE task_deliverables ADD COLUMN is_input INTEGER DEFAULT 0`);
        console.log('[Migration 008] Added is_input to task_deliverables');
      }

      if (!deliverablesInfo.some(col => col.name === 'source_task_id')) {
        db.exec(`ALTER TABLE task_deliverables ADD COLUMN source_task_id TEXT REFERENCES tasks(id)`);
        console.log('[Migration 008] Added source_task_id to task_deliverables');
      }

      console.log('[Migration 008] Workflow tables created');
    }
  },
  {
    id: '009',
    name: 'add_workflow_counterexamples',
    up: (db) => {
      console.log('[Migration 009] Adding workflow_counterexamples table...');

      db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_counterexamples (
          id TEXT PRIMARY KEY,
          template_id TEXT REFERENCES workflow_templates(id),
          run_id TEXT REFERENCES workflow_runs(id),
          failure_type TEXT NOT NULL,
          description TEXT,
          resolution TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_counterex_template ON workflow_counterexamples(template_id);
      `);

      console.log('[Migration 009] workflow_counterexamples table created');
    }
  },
  {
    id: '010',
    name: 'add_workflow_runs_dismissed',
    up: (db) => {
      console.log('[Migration 010] Adding dismissed column to workflow_runs...');

      const runsInfo = db.prepare("PRAGMA table_info(workflow_runs)").all() as { name: string }[];
      if (!runsInfo.some(col => col.name === 'dismissed')) {
        db.exec(`ALTER TABLE workflow_runs ADD COLUMN dismissed INTEGER DEFAULT 0`);
        console.log('[Migration 010] Added dismissed to workflow_runs');
      }
    }
  },
  {
    id: '011',
    name: 'add_task_step_timing_and_retry_count',
    up: (db) => {
      console.log('[Migration 011] Adding step timing + retry_count columns to tasks...');

      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];

      if (!tasksInfo.some(col => col.name === 'started_at')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN started_at TEXT`);
        console.log('[Migration 011] Added started_at to tasks');
      }

      if (!tasksInfo.some(col => col.name === 'completed_at')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN completed_at TEXT`);
        console.log('[Migration 011] Added completed_at to tasks');
      }

      if (!tasksInfo.some(col => col.name === 'retry_count')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN retry_count INTEGER DEFAULT 0`);
        console.log('[Migration 011] Added retry_count to tasks');
      }
    }
  },
  {
    id: '012',
    name: 'add_task_error_message',
    up: (db) => {
      console.log('[Migration 012] Adding error_message column to tasks...');
      const tasksInfo = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
      if (!tasksInfo.some(col => col.name === 'error_message')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN error_message TEXT`);
        console.log('[Migration 012] Added error_message to tasks');
      }
    }
  }
];

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);
  
  // Get already applied migrations
  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: string }[]).map(m => m.id)
  );
  
  // Run pending migrations in order
  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }
    
    console.log(`[DB] Running migration ${migration.id}: ${migration.name}`);
    
    try {
      // Run migration in a transaction
      db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(migration.id, migration.name);
      })();
      
      console.log(`[DB] Migration ${migration.id} completed`);
    } catch (error) {
      console.error(`[DB] Migration ${migration.id} failed:`, error);
      throw error;
    }
  }
}

/**
 * Get migration status
 */
export function getMigrationStatus(db: Database.Database): { applied: string[]; pending: string[] } {
  const applied = (db.prepare('SELECT id FROM _migrations ORDER BY id').all() as { id: string }[]).map(m => m.id);
  const pending = migrations.filter(m => !applied.includes(m.id)).map(m => m.id);
  return { applied, pending };
}
