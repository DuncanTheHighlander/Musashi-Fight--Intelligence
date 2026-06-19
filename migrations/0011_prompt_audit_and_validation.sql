-- Prompt audit log
CREATE TABLE IF NOT EXISTS musashi_prompt_audit (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'activated', 'updated')),
  user_id TEXT NULL,
  user_email TEXT NULL,
  metadata TEXT NULL, -- JSON: {oldVersionId?, reason?, changes?, validationResult?}
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
  FOREIGN KEY (template_id) REFERENCES musashi_prompt_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (version_id) REFERENCES musashi_prompt_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES musashi_users(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_musashi_prompt_audit_template_id ON musashi_prompt_audit(template_id);
CREATE INDEX IF NOT EXISTS idx_musashi_prompt_audit_created_at ON musashi_prompt_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_musashi_prompt_audit_user_id ON musashi_prompt_audit(user_id);

-- Prompt validation rules (optional, can be extended)
CREATE TABLE IF NOT EXISTS musashi_prompt_validation_rules (
  id TEXT PRIMARY KEY,
  template_key TEXT NOT NULL UNIQUE,
  max_length INTEGER NOT NULL DEFAULT 10000,
  required_placeholders TEXT NULL, -- JSON array of placeholder strings that must be present
  forbidden_patterns TEXT NULL, -- JSON array of regex patterns that must NOT be present
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
  FOREIGN KEY (template_key) REFERENCES musashi_prompt_templates(key) ON DELETE CASCADE
);

-- Ensure the referenced prompt templates exist before inserting validation
-- rules (the FK below points at musashi_prompt_templates(key); on a fresh
-- database those rows are only seeded later in 0012, which made this INSERT
-- fail with a FOREIGN KEY constraint error).
INSERT OR IGNORE INTO musashi_prompt_templates (id, key, name, description)
VALUES
  ('tpl_fight_chat', 'fight_chat_system', 'Fight Chat System Prompt', 'Main system prompt for fight coaching chat'),
  ('tpl_gameplan', 'fight_preset_gameplan', 'Gameplan Preset', 'Template for generating gameplans'),
  ('tpl_counters', 'fight_preset_counters', 'Counters Preset', 'Template for counter strategies'),
  ('tpl_corner', 'fight_preset_corner', 'Corner Talk Preset', 'Template for corner coaching');

-- Insert default validation rules for existing prompt keys
INSERT OR IGNORE INTO musashi_prompt_validation_rules (id, template_key, max_length, required_placeholders, forbidden_patterns) VALUES
  (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), 'fight_chat_system', 12000, '[]', '[]'),
  (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), 'fight_preset_gameplan', 8000, '["{{context}}", "{{pov}}"]', '[]'),
  (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), 'fight_preset_counters', 8000, '["{{context}}", "{{pov}}"]', '[]'),
  (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), 'fight_preset_corner', 8000, '["{{context}}", "{{pov}}"]', '[]');
