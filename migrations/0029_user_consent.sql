-- User consent for AI-improvement use of uploaded footage, plus the policy
-- version accepted. See docs/PRIVACY_CONSENT_SPEC.md.
ALTER TABLE musashi_users ADD COLUMN consent_ai_training INTEGER NOT NULL DEFAULT 0;
ALTER TABLE musashi_users ADD COLUMN consent_tos_version TEXT;
ALTER TABLE musashi_users ADD COLUMN consent_privacy_version TEXT;
ALTER TABLE musashi_users ADD COLUMN consent_at TEXT;
