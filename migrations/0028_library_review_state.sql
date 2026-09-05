-- Knowledge-library moderation. User-submitted documents must be approved by an
-- admin (shogun) before they can feed AI coaching retrieval. This is separate
-- from the `status` column, which tracks the ingestion lifecycle
-- (pending/processing/ready/error), not moderation.
--
-- review_state: 'pending' (awaiting admin) | 'approved' (feeds AI) | 'rejected'.
ALTER TABLE musashi_library_documents ADD COLUMN review_state TEXT NOT NULL DEFAULT 'pending';

-- Grandfather any documents that existed before moderation as approved.
UPDATE musashi_library_documents SET review_state = 'approved';

CREATE INDEX IF NOT EXISTS idx_library_docs_review_state
  ON musashi_library_documents (review_state);
