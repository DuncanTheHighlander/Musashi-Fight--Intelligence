-- Migration 0014: Expand discipline support to all martial arts
-- Adds technique taxonomy tables and expands discipline constraints

-- ============================================================
-- 1. Recreate user_fight_profiles with expanded discipline list
--    D1 doesn't support ALTER CHECK, so we recreate the table.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_fight_profiles_v2 (
  user_id TEXT PRIMARY KEY,
  preferred_discipline TEXT CHECK (preferred_discipline IN (
    'boxing', 'kickboxing', 'muay_thai', 'mma', 'wrestling', 'bjj', 'judo',
    'karate', 'taekwondo', 'sumo', 'sambo', 'other'
  )),
  preferred_stance TEXT CHECK (preferred_stance IN ('orthodox', 'southpaw', 'switch', 'unknown')),
  skill_level TEXT CHECK (skill_level IN ('beginner', 'intermediate', 'advanced', 'pro')),
  strengths TEXT DEFAULT '[]',
  weaknesses TEXT DEFAULT '[]',
  goals TEXT DEFAULT '[]',
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Copy existing data
INSERT OR IGNORE INTO user_fight_profiles_v2
  SELECT * FROM user_fight_profiles;

-- Swap tables
DROP TABLE IF EXISTS user_fight_profiles;
ALTER TABLE user_fight_profiles_v2 RENAME TO user_fight_profiles;

-- ============================================================
-- 2. Technique taxonomy tables (OutlierDB-style knowledge system)
-- ============================================================

-- Top-level technique categories per discipline
CREATE TABLE IF NOT EXISTS technique_categories (
  id TEXT PRIMARY KEY,
  discipline TEXT NOT NULL CHECK (discipline IN (
    'boxing', 'kickboxing', 'muay_thai', 'mma', 'wrestling', 'bjj', 'judo',
    'karate', 'taekwondo', 'sumo', 'sambo', 'other'
  )),
  name TEXT NOT NULL,
  parent_id TEXT,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parent_id) REFERENCES technique_categories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_technique_categories_discipline ON technique_categories(discipline);
CREATE INDEX IF NOT EXISTS idx_technique_categories_parent ON technique_categories(parent_id);

-- Individual technique entries
CREATE TABLE IF NOT EXISTS technique_entries (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  discipline TEXT NOT NULL,
  name TEXT NOT NULL,
  japanese_name TEXT,          -- For judo/karate/sumo
  korean_name TEXT,            -- For taekwondo
  description TEXT NOT NULL,
  key_points TEXT DEFAULT '[]',       -- JSON array of coaching cues
  common_mistakes TEXT DEFAULT '[]',  -- JSON array of common errors
  difficulty TEXT CHECK (difficulty IN ('beginner', 'intermediate', 'advanced', 'pro')),
  position_context TEXT,              -- e.g. 'standing', 'guard_top', 'guard_bottom', 'turtle', 'clinch'
  video_url TEXT,
  thumbnail_url TEXT,
  tags TEXT DEFAULT '[]',
  metadata TEXT DEFAULT '{}',
  effectiveness_score REAL DEFAULT 0.5,
  view_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES technique_categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_technique_entries_discipline ON technique_entries(discipline);
CREATE INDEX IF NOT EXISTS idx_technique_entries_category ON technique_entries(category_id);
CREATE INDEX IF NOT EXISTS idx_technique_entries_difficulty ON technique_entries(difficulty);
CREATE INDEX IF NOT EXISTS idx_technique_entries_position ON technique_entries(position_context);

-- Technique chains / sequences (e.g., jab → cross → hook, or armbar → triangle → omoplata)
CREATE TABLE IF NOT EXISTS technique_sequences (
  id TEXT PRIMARY KEY,
  discipline TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  steps TEXT NOT NULL DEFAULT '[]',   -- JSON array of { technique_id, notes, transition_cue }
  difficulty TEXT CHECK (difficulty IN ('beginner', 'intermediate', 'advanced', 'pro')),
  tags TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_technique_sequences_discipline ON technique_sequences(discipline);

-- Counter relationships between techniques
CREATE TABLE IF NOT EXISTS technique_counters (
  id TEXT PRIMARY KEY,
  technique_id TEXT NOT NULL,
  counter_technique_id TEXT NOT NULL,
  effectiveness TEXT CHECK (effectiveness IN ('high', 'medium', 'low')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (technique_id) REFERENCES technique_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (counter_technique_id) REFERENCES technique_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_technique_counters_technique ON technique_counters(technique_id);
CREATE INDEX IF NOT EXISTS idx_technique_counters_counter ON technique_counters(counter_technique_id);

-- ============================================================
-- 3. Match analysis storage (auto-learning from every session)
-- ============================================================

CREATE TABLE IF NOT EXISTS match_analyses (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  user_id TEXT,
  discipline TEXT,
  detected_techniques TEXT DEFAULT '[]',   -- JSON array of { technique_id, timestamp_ms, confidence }
  pattern_findings TEXT DEFAULT '[]',      -- JSON array of pattern analysis results
  kinematics_summary TEXT DEFAULT '{}',    -- JSON summary of kinematics
  ai_recommendations TEXT DEFAULT '[]',    -- JSON array of coaching recommendations
  ai_model TEXT,
  confidence_score REAL,
  duration_ms INTEGER,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES fight_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_match_analyses_session ON match_analyses(session_id);
CREATE INDEX IF NOT EXISTS idx_match_analyses_discipline ON match_analyses(discipline);
CREATE INDEX IF NOT EXISTS idx_match_analyses_user ON match_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_match_analyses_created ON match_analyses(created_at);

-- ============================================================
-- 4. AI coaching feedback table
-- ============================================================

CREATE TABLE IF NOT EXISTS coaching_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  session_id TEXT,
  message_index INTEGER,
  rating INTEGER CHECK (rating IN (-1, 1)),  -- thumbs down / thumbs up
  ai_model TEXT,
  prompt_template_key TEXT,
  discipline TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_coaching_feedback_user ON coaching_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_coaching_feedback_rating ON coaching_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_coaching_feedback_discipline ON coaching_feedback(discipline);
