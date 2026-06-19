-- Add photo_uploads table
CREATE TABLE IF NOT EXISTS photo_uploads (
  id TEXT PRIMARY KEY,
  property_id TEXT,
  appointment_id TEXT,
  cleaner_id TEXT,
  uploaded_by TEXT NOT NULL,
  upload_type TEXT NOT NULL CHECK (upload_type IN ('property', 'cleaning', 'damage')),
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE,
  FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE,
  FOREIGN KEY (cleaner_id) REFERENCES cleaners (id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE CASCADE
);

-- Add time_logs table for cleaner time tracking
CREATE TABLE IF NOT EXISTS time_logs (
  id TEXT PRIMARY KEY,
  cleaner_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  log_type TEXT NOT NULL CHECK (log_type IN ('start', 'pause', 'resume', 'end')),
  timestamp TEXT NOT NULL,
  location TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (cleaner_id) REFERENCES cleaners (id) ON DELETE CASCADE,
  FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE
);

-- Update cleaner_appointments table to include time tracking fields
ALTER TABLE cleaner_appointments ADD COLUMN total_time_seconds INTEGER DEFAULT 0;
ALTER TABLE cleaner_appointments ADD COLUMN time_logs TEXT;
