-- Migration number: 0009 	2025-12-30
-- Musashi Kinematics Persistence Layer

-- Create fight_sessions table for session management
CREATE TABLE IF NOT EXISTS fight_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  ruleset TEXT CHECK (ruleset IN ('boxing', 'kickboxing', 'muay_thai', 'mma', 'unknown', 'training')),
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'paused', 'cancelled')) DEFAULT 'active',
  start_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_time DATETIME,
  duration_seconds INTEGER,
  opponent_id TEXT, -- Reference to another user if sparring
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (opponent_id) REFERENCES users (id) ON DELETE SET NULL
);

-- Create kinematics_snapshots table for real-time biomechanical data
CREATE TABLE IF NOT EXISTS kinematics_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  frame_number INTEGER,
  
  -- Speed metrics (body-widths per second)
  hand_speed_bwps REAL,
  hand_burst_bwps REAL,
  foot_speed_bwps REAL,
  hip_speed_bwps REAL,
  
  -- Power and force metrics
  power_index REAL,
  strike_force_estimate REAL,
  
  -- Range and positioning
  range_distance_bw REAL,
  range_closing_bwps REAL,
  range_state TEXT CHECK (range_state IN ('long', 'mid', 'close', 'clinched', 'grounded')),
  
  -- Technique classification
  technique_type TEXT,
  technique_confidence REAL,
  combination_sequence TEXT, -- JSON array of technique IDs
  
  -- Pose data (compressed JSON)
  pose_keypoints TEXT, -- JSON MediaPipe pose landmarks
  pose_confidence REAL,
  
  -- Fighter identification
  fighter_id TEXT, -- 'A' or 'B' for dual tracking
  fighter_stance TEXT CHECK (fighter_stance IN ('orthodox', 'southpaw', 'switch', 'unknown')),
  
  -- Raw kinematics blob for detailed analysis
  raw_kinematics TEXT, -- JSON blob of all available kinematic data
  
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES fight_sessions (id) ON DELETE CASCADE
);

-- Create performance_metrics table for aggregated session data
CREATE TABLE IF NOT EXISTS performance_metrics (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  
  -- Speed aggregates
  avg_hand_speed_bwps REAL,
  max_hand_speed_bwps REAL,
  avg_hand_burst_bwps REAL,
  max_hand_burst_bwps REAL,
  avg_foot_speed_bwps REAL,
  max_foot_speed_bwps REAL,
  avg_hip_speed_bwps REAL,
  max_hip_speed_bwps REAL,
  
  -- Power aggregates
  avg_power_index REAL,
  max_power_index REAL,
  total_strikes INTEGER,
  total_power_score REAL,
  
  -- Range analysis
  avg_range_distance_bw REAL,
  time_in_close_range_seconds REAL,
  time_in_mid_range_seconds REAL,
  time_in_long_range_seconds REAL,
  
  -- Technique diversity
  unique_techniques_count INTEGER,
  technique_diversity_score REAL, -- Shannon entropy of technique distribution
  
  -- Performance indicators
  consistency_score REAL, -- Variance in speed/power metrics
  efficiency_score REAL, -- Power output vs energy expenditure estimate
  fatigue_rate REAL, -- Performance degradation over time
  
  -- Session summary
  total_frames_analyzed INTEGER,
  data_quality_score REAL, -- Percentage of frames with valid kinematics
  
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES fight_sessions (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Create technique_analysis table for detailed technique breakdown
CREATE TABLE IF NOT EXISTS technique_analysis (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  
  -- Technique identification
  technique_name TEXT NOT NULL,
  technique_category TEXT CHECK (technique_category IN ('punch', 'kick', 'knee', 'elbow', 'clinch', 'takedown', 'defense', 'movement')),
  variant TEXT, -- e.g., 'jab', 'cross', 'roundhouse', 'front_kick'
  
  -- Execution metrics
  execution_count INTEGER DEFAULT 0,
  avg_speed_bwps REAL,
  max_speed_bwps REAL,
  avg_power_index REAL,
  max_power_index REAL,
  
  -- Accuracy and effectiveness
  success_rate REAL, -- Based on follow-up analysis
  impact_quality REAL, -- Estimated from kinematics
  
  -- Timing and rhythm
  avg_execution_time_ms REAL,
  rhythm_pattern TEXT, -- JSON representation of timing patterns
  
  -- Contextual data
  range_state TEXT CHECK (range_state IN ('long', 'mid', 'close', 'clinched', 'grounded')),
  opponent_distance_bw REAL,
  setup_techniques TEXT, -- JSON array of preceding techniques
  
  -- Improvement suggestions
  improvement_areas TEXT, -- JSON array of identified issues
  coaching_notes TEXT,
  
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES fight_sessions (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Create indexes for optimal query performance
CREATE INDEX idx_fight_sessions_user_id ON fight_sessions(user_id);
CREATE INDEX idx_fight_sessions_status ON fight_sessions(status);
CREATE INDEX idx_fight_sessions_start_time ON fight_sessions(start_time);
CREATE INDEX idx_fight_sessions_opponent_id ON fight_sessions(opponent_id);

CREATE INDEX idx_kinematics_snapshots_session_id ON kinematics_snapshots(session_id);
CREATE INDEX idx_kinematics_snapshots_timestamp ON kinematics_snapshots(timestamp);
CREATE INDEX idx_kinematics_snapshots_fighter_id ON kinematics_snapshots(fighter_id);
CREATE INDEX idx_kinematics_snapshots_technique_type ON kinematics_snapshots(technique_type);

CREATE INDEX idx_performance_metrics_session_id ON performance_metrics(session_id);
CREATE INDEX idx_performance_metrics_user_id ON performance_metrics(user_id);
CREATE INDEX idx_performance_metrics_created_at ON performance_metrics(created_at);

CREATE INDEX idx_technique_analysis_session_id ON technique_analysis(session_id);
CREATE INDEX idx_technique_analysis_user_id ON technique_analysis(user_id);
CREATE INDEX idx_technique_analysis_technique_name ON technique_analysis(technique_name);
CREATE INDEX idx_technique_analysis_category ON technique_analysis(technique_category);

-- Create composite indexes for common queries
CREATE INDEX idx_fight_sessions_user_status_time ON fight_sessions(user_id, status, start_time DESC);
CREATE INDEX idx_kinematics_session_timestamp ON kinematics_snapshots(session_id, timestamp DESC);
CREATE INDEX idx_performance_user_session_time ON performance_metrics(user_id, session_id, created_at DESC);
