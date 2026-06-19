-- Migration number: 0007  2025-12-26
-- Musashi Social Graph schema + seed data

-- Fighter profiles
CREATE TABLE IF NOT EXISTS fighter_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '{}', -- JSON {city,state,country}
  weight_class TEXT NOT NULL,
  discipline TEXT NOT NULL,
  record TEXT NOT NULL DEFAULT '{"wins":0,"losses":0,"draws":0,"kos":0}',
  stance TEXT NOT NULL DEFAULT 'orthodox',
  team TEXT NOT NULL DEFAULT '',
  social_links TEXT NOT NULL DEFAULT '{}',
  is_verified INTEGER NOT NULL DEFAULT 0,
  is_pro INTEGER NOT NULL DEFAULT 0,
  followers INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fighter_profiles_weight_class ON fighter_profiles(weight_class);
CREATE INDEX IF NOT EXISTS idx_fighter_profiles_discipline ON fighter_profiles(discipline);
CREATE INDEX IF NOT EXISTS idx_fighter_profiles_verified ON fighter_profiles(is_verified DESC);

-- Scouting requests
CREATE TABLE IF NOT EXISTS scouting_requests (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  opponent_name TEXT NOT NULL,
  opponent_info TEXT NOT NULL DEFAULT '{}', -- JSON {weightClass,record,notableFights[],style}
  fight_date TEXT,
  location TEXT NOT NULL,
  description TEXT NOT NULL,
  videos TEXT NOT NULL DEFAULT '[]', -- JSON array of URLs
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed')),
  response_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scouting_requests_status ON scouting_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scouting_requests_author ON scouting_requests(author_id);

CREATE TABLE IF NOT EXISTS analysis_responses (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  responder_id TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  rating INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES scouting_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (responder_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analysis_responses_request ON analysis_responses(request_id);
CREATE INDEX IF NOT EXISTS idx_analysis_responses_responder ON analysis_responses(responder_id);

-- Direct messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages(sender_id, receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, is_read);

-- Seed helper
INSERT OR IGNORE INTO users (id, role, email, password_hash, first_name, last_name, phone, created_at, updated_at)
VALUES
  ('user_fighter_1', 'client', 'alex@example.com', 'hash', 'Alex', 'Rodriguez', null, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user_coach_1', 'client', 'sarah@example.com', 'hash', 'Sarah', 'Chen', null, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user_fighter_2', 'client', 'mike@example.com', 'hash', 'Mike', 'Johnson', null, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('user_scout_1', 'client', 'lena@example.com', 'hash', 'Lena', 'Kobayashi', null, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR REPLACE INTO fighter_profiles (
  id, user_id, display_name, bio, location, weight_class, discipline, record, stance, team, social_links,
  is_verified, is_pro, followers, created_at, updated_at
) VALUES
  (
    'profile_alex', 'user_fighter_1', 'Alex "The Ghost" Rodriguez',
    'Welterweight striker focusing on feints, angle work, and AI-powered coaching.',
    '{"city":"Atlanta","state":"GA","country":"USA"}',
    'Welterweight', 'mma', '{"wins":18,"losses":4,"draws":0,"kos":8}', 'orthodox', 'American Top Team',
    '{"instagram":"https://instagram.com/ghostalex"}', 1, 1, 12800, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'profile_sarah', 'user_coach_1', 'Sarah Chen',
    'Muay Thai specialist offering remote breakdowns and clinch gameplans.',
    '{"city":"Los Angeles","state":"CA","country":"USA"}',
    'Featherweight', 'muay_thai', '{"wins":12,"losses":2,"draws":1,"kos":6}', 'southpaw', 'Chen Muay Thai',
    '{"youtube":"https://youtube.com/@sarahchen"}', 1, 0, 9200, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'profile_mike', 'user_fighter_2', 'Mike Johnson',
    'Lightweight pressure fighter drilling body-shot counters.',
    '{"city":"Denver","state":"CO","country":"USA"}',
    'Lightweight', 'boxing', '{"wins":15,"losses":3,"draws":0,"kos":9}', 'orthodox', 'Mile High Boxing',
    '{}', 0, 1, 3100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'profile_lena', 'user_scout_1', 'Lena Kobayashi',
    'Former atomweight champion now scouting opponents for elite camps.',
    '{"city":"Tokyo","state":"","country":"Japan"}',
    'Atomweight', 'mma', '{"wins":22,"losses":2,"draws":0,"kos":5}', 'switch', 'Shogun Elite',
    '{}', 1, 1, 6400, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

INSERT OR REPLACE INTO scouting_requests (
  id, author_id, opponent_name, opponent_info, fight_date, location, description, videos, tags, status, response_count, created_at, updated_at
) VALUES
  (
    'scout_req_1', 'user_fighter_1', 'Carlos "El Toro" Mendez',
    '{"weightClass":"Lightweight","record":"15-3-0","notableFights":["Five-fight streak","Beat ranked #3"],"style":"Forward pressure, heavy hooks"}',
    '2025-02-15', 'Atlanta, GA',
    'Need a detailed plan to slow down his pressure and punish the overhand right. Looking for drills + sequences.',
    '[]', '["boxing","pressure","gameplan"]', 'open', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'scout_req_2', 'user_coach_1', 'Unknown Thai Fighter',
    '{"weightClass":"Featherweight","record":"Unknown","notableFights":[],"style":"Traditional Muay Thai"}',
    NULL, 'Los Angeles, CA',
    'Facing a tall southpaw clinch specialist. Need elbow/sweep counters + sparring cues.',
    '[]', '["muay_thai","clinch","southpaw"]', 'in_progress', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

INSERT OR REPLACE INTO analysis_responses (
  id, request_id, responder_id, content, attachments, rating, created_at
) VALUES
  (
    'resp_1', 'scout_req_1', 'user_scout_1',
    'Angle out on his jab, double-step to orthodox outside, hammer counter right uppercut. Added drill plan in attachments.',
    '["https://cdn.musashi.ai/drills/el_toro_plan.pdf"]', 5, CURRENT_TIMESTAMP
  ),
  (
    'resp_2', 'scout_req_2', 'user_fighter_2',
    'Focus on collar-tie posture breaks. I shared a video demonstration.',
    '["https://cdn.musashi.ai/videos/clinch-demo.mp4"]', 4, CURRENT_TIMESTAMP
  );

INSERT OR REPLACE INTO messages (
  id, sender_id, receiver_id, content, attachments, is_read, created_at
) VALUES
  ('msg_1', 'user_fighter_1', 'user_scout_1', 'Appreciate the breakdown—can we schedule a Zoom session?', '[]', 0, CURRENT_TIMESTAMP),
  ('msg_2', 'user_scout_1', 'user_fighter_1', 'Absolutely. I can do tomorrow 3pm ET. Sending link.', '[]', 0, CURRENT_TIMESTAMP),
  ('msg_3', 'user_coach_1', 'user_fighter_2', 'Saw your southpaw spar clip. Keep your rear shoulder high exiting the clinch.', '[]', 1, CURRENT_TIMESTAMP);
