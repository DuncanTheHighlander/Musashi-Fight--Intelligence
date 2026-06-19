-- Migration: Social Performance Integration
-- Add performance metrics and analysis data to existing social tables

-- content_products was previously only defined in src/lib/database.sql (never a
-- migration), which made the ALTER TABLE statements below fail on a fresh
-- database. Create the base table here so the chain applies cleanly end-to-end.
CREATE TABLE IF NOT EXISTS content_products (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('technique', 'breakdown', 'training', 'coaching')),
  price REAL NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  video_url TEXT,
  thumbnail_url TEXT,
  duration INTEGER DEFAULT 0, -- seconds, 0 for services
  tags TEXT DEFAULT '[]', -- JSON array
  is_published BOOLEAN DEFAULT false,
  sales_count INTEGER DEFAULT 0,
  rating REAL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  review_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_content_products_creator_id ON content_products(creator_id);
CREATE INDEX IF NOT EXISTS idx_content_products_type ON content_products(type);
CREATE INDEX IF NOT EXISTS idx_content_products_published ON content_products(is_published);

-- Update fighter_profiles table to include performance stats and skill verification
ALTER TABLE fighter_profiles ADD COLUMN performance_stats TEXT DEFAULT '{}';
ALTER TABLE fighter_profiles ADD COLUMN skill_verification TEXT DEFAULT '{}';

-- Update scouting_requests table to include performance metrics and technique analysis
ALTER TABLE scouting_requests ADD COLUMN performance_metrics TEXT DEFAULT '{}';
ALTER TABLE scouting_requests ADD COLUMN technique_analysis TEXT DEFAULT '{}';

-- Update content_products table to include effectiveness tracking
ALTER TABLE content_products ADD COLUMN technique_success_rate REAL DEFAULT 0;
ALTER TABLE content_products ADD COLUMN avg_improvement_rate REAL DEFAULT 0;
ALTER TABLE content_products ADD COLUMN user_skill_level TEXT DEFAULT 'intermediate' CHECK (user_skill_level IN ('beginner', 'intermediate', 'advanced', 'pro'));
ALTER TABLE content_products ADD COLUMN real_world_application REAL DEFAULT 0;
ALTER TABLE content_products ADD COLUMN biomechanical_efficiency REAL DEFAULT 0;
ALTER TABLE content_products ADD COLUMN total_practitioners INTEGER DEFAULT 0;
ALTER TABLE content_products ADD COLUMN verified_results BOOLEAN DEFAULT FALSE;

-- Update messages table to support analysis sharing
ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'analysis', 'technique', 'scouting'));
ALTER TABLE messages ADD COLUMN analysis_data TEXT DEFAULT NULL;

-- Create skill_verifications table for technique verification system
CREATE TABLE IF NOT EXISTS skill_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  technique_name TEXT NOT NULL,
  technique_category TEXT CHECK (technique_category IN ('punch', 'kick', 'knee', 'elbow', 'clinch', 'takedown', 'defense', 'movement')),
  video_evidence TEXT, -- JSON array of video URLs or evidence
  kinematics_snapshot TEXT, -- JSON blob of kinematics data at time of verification
  status TEXT CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  reviewer_id TEXT, -- NULL for auto-verification
  review_notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users (id) ON DELETE SET NULL
);

-- Create indexes for new performance-related queries
CREATE INDEX idx_fighter_profiles_performance_stats ON fighter_profiles(user_id, performance_stats);
CREATE INDEX idx_fighter_profiles_skill_verification ON fighter_profiles(user_id, skill_verification);
CREATE INDEX idx_scouting_requests_performance_metrics ON scouting_requests(author_id, performance_metrics);
CREATE INDEX idx_scouting_requests_technique_analysis ON scouting_requests(author_id, technique_analysis);
CREATE INDEX idx_content_products_effectiveness ON content_products(creator_id, technique_success_rate, verified_results);
CREATE INDEX idx_messages_analysis_data ON messages(sender_id, message_type, analysis_data);
CREATE INDEX idx_skill_verifications_user_id ON skill_verifications(user_id, status);
CREATE INDEX idx_skill_verifications_technique ON skill_verifications(technique_name, status);

-- Create composite indexes for complex performance queries
CREATE INDEX idx_profiles_performance_verification ON fighter_profiles(user_id, performance_stats, skill_verification);
CREATE INDEX idx_content_effectiveness_creator ON content_products(creator_id, verified_results, avg_improvement_rate);
CREATE INDEX idx_messages_analysis_sharing ON messages(message_type, created_at DESC) WHERE analysis_data IS NOT NULL;
