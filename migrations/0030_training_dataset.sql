-- Migration 0030: Training dataset flywheel + pose snapshots for ML export
-- Pose snapshots are stored at analyze time (compact 2D keypoints only).
-- training_dataset rows are created when shogun confirms/relabels detections.

CREATE TABLE IF NOT EXISTS ledger_pose_snapshots (
  ledger_id TEXT PRIMARY KEY,
  pose_frames_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (ledger_id) REFERENCES fight_analysis_ledgers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS training_dataset (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL,
  ledger_id TEXT NOT NULL,
  correction_id TEXT,
  sport TEXT,
  raw_2d_keypoints TEXT NOT NULL,
  original_label TEXT,
  corrected_label TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (ledger_id) REFERENCES fight_analysis_ledgers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_training_dataset_ledger ON training_dataset(ledger_id);
CREATE INDEX IF NOT EXISTS idx_training_dataset_created ON training_dataset(created_at);
