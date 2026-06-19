CREATE TABLE IF NOT EXISTS musashi_prompt_templates (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_musashi_prompt_templates_key ON musashi_prompt_templates(key);

CREATE TABLE IF NOT EXISTS musashi_prompt_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES musashi_prompt_templates (id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES musashi_users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_musashi_prompt_versions_template_version ON musashi_prompt_versions(template_id, version);
CREATE INDEX IF NOT EXISTS idx_musashi_prompt_versions_template_id ON musashi_prompt_versions(template_id);

CREATE TABLE IF NOT EXISTS musashi_prompt_active (
  template_id TEXT PRIMARY KEY,
  active_version_id TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES musashi_prompt_templates (id) ON DELETE CASCADE,
  FOREIGN KEY (active_version_id) REFERENCES musashi_prompt_versions (id) ON DELETE CASCADE
);
