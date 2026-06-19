-- Migration number: 0008  2025-12-26
-- Musashi Messaging + Notifications rollout

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS __musashi_messages_migration (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  is_read INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (sender_id) REFERENCES musashi_users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES musashi_users(id) ON DELETE CASCADE
);

INSERT INTO __musashi_messages_migration (
  id,
  sender_id,
  receiver_id,
  content,
  attachments,
  is_read,
  read_at,
  created_at
)
SELECT
  id,
  sender_id,
  receiver_id,
  content,
  COALESCE(attachments, '[]'),
  CASE
    WHEN is_read IN (1, '1', 'true', 'TRUE') THEN 1
    ELSE 0
  END AS is_read,
  CASE
    WHEN is_read IN (1, '1', 'true', 'TRUE') THEN created_at
    ELSE NULL
  END AS read_at,
  created_at
FROM messages;

DROP TABLE IF EXISTS messages;
ALTER TABLE __musashi_messages_migration RENAME TO messages;

PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(receiver_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS musashi_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  body TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  read_at TEXT,
  FOREIGN KEY (user_id) REFERENCES musashi_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_musashi_notifications_user ON musashi_notifications(user_id, is_read, created_at);
CREATE INDEX IF NOT EXISTS idx_musashi_notifications_created_at ON musashi_notifications(created_at);
