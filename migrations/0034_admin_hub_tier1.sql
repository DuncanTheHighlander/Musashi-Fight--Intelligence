-- Tier 1 Admin Hub: runtime kill switch, account status, comp Pro, audit log.

CREATE TABLE IF NOT EXISTS musashi_runtime_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS musashi_admin_audit_log (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  result TEXT NOT NULL DEFAULT 'ok',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_musashi_admin_audit_created
  ON musashi_admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_musashi_admin_audit_target
  ON musashi_admin_audit_log(target_type, target_id);

ALTER TABLE musashi_users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE musashi_users ADD COLUMN status_reason TEXT;
ALTER TABLE musashi_users ADD COLUMN support_notes TEXT;
ALTER TABLE musashi_users ADD COLUMN comp_pro_until TEXT;
ALTER TABLE musashi_users ADD COLUMN bonus_video_credits INTEGER NOT NULL DEFAULT 0;
