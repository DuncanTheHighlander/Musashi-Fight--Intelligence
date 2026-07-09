-- Migration number: 0031	 2026-07-09
-- User-generated content reports (store policy: report/block path for marketplace UGC)

CREATE TABLE IF NOT EXISTS musashi_content_reports (
  id TEXT PRIMARY KEY,
  reporter_user_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('job', 'profile', 'message', 'product', 'other')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'inappropriate', 'scam', 'ip', 'other')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  resolved_by TEXT,
  FOREIGN KEY (reporter_user_id) REFERENCES musashi_users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_content_reports_status ON musashi_content_reports (status, created_at);
CREATE INDEX IF NOT EXISTS idx_content_reports_target ON musashi_content_reports (target_type, target_id);
