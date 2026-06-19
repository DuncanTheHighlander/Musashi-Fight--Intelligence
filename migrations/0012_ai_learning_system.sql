-- Migration 0012: AI Learning System and Missing Tables
-- Adds knowledge library, prompt management, and kinematics persistence

-- ============================================================================
-- AI KNOWLEDGE LIBRARY TABLES
-- ============================================================================

-- Documents in the knowledge base (fights, techniques, drills)
CREATE TABLE IF NOT EXISTS musashi_library_documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'url', 'file', 'api')),
  author TEXT,
  tags TEXT NOT NULL DEFAULT '[]', -- JSON array
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'ready', 'error')) DEFAULT 'pending',
  content TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  vector_count INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}', -- JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_library_docs_status ON musashi_library_documents(status);
CREATE INDEX IF NOT EXISTS idx_library_docs_source_type ON musashi_library_documents(source_type);
CREATE INDEX IF NOT EXISTS idx_library_docs_created_at ON musashi_library_documents(created_at);

-- Text chunks for vector search
CREATE TABLE IF NOT EXISTS musashi_library_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  vector_id TEXT, -- Cloudflare Vectorize ID
  metadata TEXT NOT NULL DEFAULT '{}', -- JSON
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES musashi_library_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_library_chunks_doc ON musashi_library_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_library_chunks_vector ON musashi_library_chunks(vector_id);

-- Ingestion job tracking
CREATE TABLE IF NOT EXISTS musashi_library_ingestions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES musashi_library_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_library_ingestions_status ON musashi_library_ingestions(status);
CREATE INDEX IF NOT EXISTS idx_library_ingestions_doc ON musashi_library_ingestions(document_id);

-- ============================================================================
-- PROMPT MANAGEMENT SYSTEM
-- ============================================================================

-- Prompt templates (system prompts that can be versioned)
CREATE TABLE IF NOT EXISTS musashi_prompt_templates (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_key ON musashi_prompt_templates(key);

-- Versions of prompts (for A/B testing and rollback)
CREATE TABLE IF NOT EXISTS musashi_prompt_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (template_id) REFERENCES musashi_prompt_templates(id) ON DELETE CASCADE,
  UNIQUE(template_id, version)
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_template ON musashi_prompt_versions(template_id);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_version ON musashi_prompt_versions(template_id, version);

-- Active prompt version (which version is currently live)
CREATE TABLE IF NOT EXISTS musashi_prompt_active (
  template_id TEXT PRIMARY KEY,
  active_version_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (template_id) REFERENCES musashi_prompt_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (active_version_id) REFERENCES musashi_prompt_versions(id)
);

-- Validation rules for prompts
CREATE TABLE IF NOT EXISTS musashi_prompt_validation_rules (
  template_key TEXT PRIMARY KEY,
  max_length INTEGER DEFAULT 10000,
  required_placeholders TEXT DEFAULT '[]', -- JSON array
  forbidden_patterns TEXT DEFAULT '[]' -- JSON array
);

-- Audit log for prompt changes
CREATE TABLE IF NOT EXISTS musashi_prompt_audit (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'activated', 'deactivated', 'deleted')),
  user_id TEXT,
  user_email TEXT,
  metadata TEXT, -- JSON
  created_at TEXT NOT NULL,
  FOREIGN KEY (template_id) REFERENCES musashi_prompt_templates(id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_audit_template ON musashi_prompt_audit(template_id);
CREATE INDEX IF NOT EXISTS idx_prompt_audit_created ON musashi_prompt_audit(created_at);

-- ============================================================================
-- FIGHT SESSIONS AND KINEMATICS PERSISTENCE
-- ============================================================================

-- Fight analysis sessions
CREATE TABLE IF NOT EXISTS fight_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  video_url TEXT,
  video_file_name TEXT,
  duration_sec REAL,
  analysis_count INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}', -- JSON: ruleset, fighters, etc.
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fight_sessions_user ON fight_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_fight_sessions_created ON fight_sessions(created_at);

-- Kinematics snapshots (time-series biomechanical data)
CREATE TABLE IF NOT EXISTS kinematics_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  frame_number INTEGER,
  fighter_id TEXT CHECK (fighter_id IN ('A', 'B')),
  hand_speed_bwps REAL,
  hand_burst_bwps REAL,
  foot_speed_bwps REAL,
  hip_speed_bwps REAL,
  power_index REAL,
  range_distance_bw REAL,
  range_closing_bwps REAL,
  range_state TEXT CHECK (range_state IN ('close', 'mid', 'long', 'unknown')),
  technique_type TEXT,
  technique_confidence REAL,
  raw_kinematics TEXT NOT NULL, -- JSON: full snapshot data
  FOREIGN KEY (session_id) REFERENCES fight_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kinematics_session ON kinematics_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_kinematics_timestamp ON kinematics_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_kinematics_fighter ON kinematics_snapshots(session_id, fighter_id);

-- ============================================================================
-- ACTIVITY LOG (if not exists)
-- ============================================================================

CREATE TABLE IF NOT EXISTS musashi_activity_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('library', 'chat', 'analyze', 'reflex', 'track', 'auth', 'session')),
  subtype TEXT,
  reference_id TEXT,
  metadata TEXT DEFAULT '{}', -- JSON
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 0006 already created musashi_activity_log WITHOUT a user_id column, so the
-- CREATE TABLE IF NOT EXISTS above is a no-op on the migration chain. Add the
-- column so the index below works.
ALTER TABLE musashi_activity_log ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_activity_log_user ON musashi_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_type ON musashi_activity_log(type);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON musashi_activity_log(created_at);

-- ============================================================================
-- USER FIGHT PROFILES (for personalized learning)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_fight_profiles (
  user_id TEXT PRIMARY KEY,
  preferred_discipline TEXT CHECK (preferred_discipline IN ('boxing', 'kickboxing', 'muay_thai', 'mma', 'other')),
  preferred_stance TEXT CHECK (preferred_stance IN ('orthodox', 'southpaw', 'switch', 'unknown')),
  skill_level TEXT CHECK (skill_level IN ('beginner', 'intermediate', 'advanced', 'pro')),
  strengths TEXT DEFAULT '[]', -- JSON array of technique IDs
  weaknesses TEXT DEFAULT '[]', -- JSON array of technique IDs
  goals TEXT DEFAULT '[]', -- JSON array of training goals
  metadata TEXT DEFAULT '{}', -- JSON: additional profile data
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User technique history (for adaptive coaching)
CREATE TABLE IF NOT EXISTS user_technique_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  technique_id TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  successes INTEGER DEFAULT 0,
  success_rate REAL DEFAULT 0,
  avg_power_index REAL,
  avg_speed_bwps REAL,
  last_practiced TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_technique_history_user ON user_technique_history(user_id);
CREATE INDEX IF NOT EXISTS idx_technique_history_technique ON user_technique_history(technique_id);
CREATE INDEX IF NOT EXISTS idx_technique_history_last_practiced ON user_technique_history(last_practiced);

-- ============================================================================
-- SEED DEFAULT PROMPT TEMPLATES
-- ============================================================================

INSERT OR IGNORE INTO musashi_prompt_templates (id, key, name, description, updated_at)
VALUES 
  ('tpl_fight_chat', 'fight_chat_system', 'Fight Chat System Prompt', 'Main system prompt for fight coaching chat', datetime('now')),
  ('tpl_gameplan', 'fight_preset_gameplan', 'Gameplan Preset', 'Template for generating gameplans', datetime('now')),
  ('tpl_counters', 'fight_preset_counters', 'Counters Preset', 'Template for counter strategies', datetime('now')),
  ('tpl_corner', 'fight_preset_corner', 'Corner Talk Preset', 'Template for corner coaching', datetime('now'));

-- Default versions
INSERT OR IGNORE INTO musashi_prompt_versions (id, template_id, version, content, created_at)
VALUES 
  ('ver_fight_chat_1', 'tpl_fight_chat', 1, 
   'You are Musashi Fight Coach: elite corner, analyst, and strategist.
Be high-signal and practical. No fluff, no disclaimers, no generic motivation.
Always blend tactics + strategy in the SAME answer (do not treat "strategy" as separate).
When possible, structure responses as:
1) Immediate fixes (1-3 short cues)
2) Plan (range + tempo + primary win condition)
3) Counters/setups (2-4 concrete options)
4) Drill (one drill to install it)
If context includes an analysis with fighter candidates, reference Fighter A/B and the selected fighter.', 
   datetime('now'));

-- Set active versions
INSERT OR IGNORE INTO musashi_prompt_active (template_id, active_version_id, updated_at)
VALUES ('tpl_fight_chat', 'ver_fight_chat_1', datetime('now'));

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
