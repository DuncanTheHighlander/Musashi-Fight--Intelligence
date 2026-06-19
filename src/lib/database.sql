-- Musashi Social Platform Database Schema

-- Users table (extends existing auth)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'shogun')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Fighter Profiles
CREATE TABLE IF NOT EXISTS fighter_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  bio TEXT DEFAULT '',
  location TEXT NOT NULL, -- JSON: {city, state, country}
  weight_class TEXT NOT NULL,
  discipline TEXT NOT NULL CHECK (discipline IN ('boxing', 'kickboxing', 'muay_thai', 'mma', 'other')),
  record TEXT NOT NULL, -- JSON: {wins, losses, draws, kos}
  stance TEXT DEFAULT 'unknown' CHECK (stance IN ('orthodox', 'southpaw', 'switch', 'unknown')),
  team TEXT DEFAULT '',
  social_links TEXT DEFAULT '{}', -- JSON: {instagram, twitter, youtube}
  is_verified BOOLEAN DEFAULT false,
  is_pro BOOLEAN DEFAULT false,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Scouting Requests
CREATE TABLE IF NOT EXISTS scouting_requests (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  opponent_name TEXT NOT NULL,
  opponent_info TEXT NOT NULL, -- JSON: {weightClass, record, notableFights, style}
  fight_date TEXT,
  location TEXT NOT NULL,
  description TEXT NOT NULL,
  videos TEXT DEFAULT '[]', -- JSON array of video URLs
  tags TEXT DEFAULT '[]', -- JSON array of tags
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed')),
  response_count INTEGER DEFAULT 0,
  budget REAL DEFAULT 0,
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'targeted')),
  opponent_videos TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Analysis Responses
CREATE TABLE IF NOT EXISTS analysis_responses (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  analyst_id TEXT NOT NULL,
  content TEXT NOT NULL,
  video_breakdown TEXT DEFAULT '[]', -- JSON: [{videoId, timestamps}]
  rating REAL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  is_helpful BOOLEAN DEFAULT false,
  created_at TEXT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES scouting_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (analyst_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Breakdown Offers (coaches respond to scouting requests)
CREATE TABLE IF NOT EXISTS breakdown_offers (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  coach_id TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  estimated_delivery TEXT,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'completed', 'declined')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES scouting_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (coach_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Content Products (Marketplace)
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

-- Purchases
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  stripe_payment_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'refunded')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES content_products(id) ON DELETE CASCADE
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT DEFAULT '[]', -- JSON array of file URLs
  is_read BOOLEAN DEFAULT false,
  created_at TEXT NOT NULL,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Follows
CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  follower_id TEXT NOT NULL,
  following_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(follower_id, following_id)
);

-- Reviews
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  reviewer_id TEXT NOT NULL,
  target_id TEXT NOT NULL, -- user_id or product_id
  target_type TEXT NOT NULL CHECK (target_type IN ('user', 'product')),
  rating REAL NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT DEFAULT '',
  review_phase TEXT DEFAULT NULL CHECK (review_phase IN ('pre_fight', 'post_fight')),
  fight_outcome TEXT DEFAULT NULL CHECK (fight_outcome IN ('win', 'loss', 'draw')),
  coaching_session_id TEXT DEFAULT NULL,
  advice_effectiveness INTEGER DEFAULT NULL CHECK (advice_effectiveness >= 1 AND advice_effectiveness <= 5),
  created_at TEXT NOT NULL,
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User Limits (extends existing usage system)
CREATE TABLE IF NOT EXISTS musashi_user_limits (
  user_id TEXT PRIMARY KEY,
  daily_analyze_limit INTEGER,
  daily_chat_limit INTEGER,
  daily_reflex_limit INTEGER,
  daily_track_limit INTEGER,
  per_minute_limit INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Stripe Subscriptions (extends existing billing)
CREATE TABLE IF NOT EXISTS musashi_stripe_customers (
  user_id TEXT PRIMARY KEY,
  stripe_customer_id TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_musashi_stripe_customers_customer_id ON musashi_stripe_customers(stripe_customer_id);

CREATE TABLE IF NOT EXISTS musashi_stripe_subscriptions (
  stripe_subscription_id TEXT PRIMARY KEY,
  user_id TEXT,
  stripe_customer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  price_id TEXT,
  product_id TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  current_period_end TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_musashi_stripe_subscriptions_user_id ON musashi_stripe_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_musashi_stripe_subscriptions_customer_id ON musashi_stripe_subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_musashi_stripe_subscriptions_status ON musashi_stripe_subscriptions(status);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_fighter_profiles_user_id ON fighter_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_fighter_profiles_discipline ON fighter_profiles(discipline);
CREATE INDEX IF NOT EXISTS idx_fighter_profiles_location ON fighter_profiles(location);
CREATE INDEX IF NOT EXISTS idx_scouting_requests_author_id ON scouting_requests(author_id);
CREATE INDEX IF NOT EXISTS idx_scouting_requests_status ON scouting_requests(status);
CREATE INDEX IF NOT EXISTS idx_analysis_responses_request_id ON analysis_responses(request_id);
CREATE INDEX IF NOT EXISTS idx_analysis_responses_analyst_id ON analysis_responses(analyst_id);
CREATE INDEX IF NOT EXISTS idx_content_products_creator_id ON content_products(creator_id);
CREATE INDEX IF NOT EXISTS idx_content_products_type ON content_products(type);
CREATE INDEX IF NOT EXISTS idx_content_products_published ON content_products(is_published);
CREATE INDEX IF NOT EXISTS idx_purchases_buyer_id ON purchases(buyer_id);
CREATE INDEX IF NOT EXISTS idx_purchases_product_id ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_reviews_target_id ON reviews(target_id);
CREATE INDEX IF NOT EXISTS idx_reviews_target_type ON reviews(target_type);
CREATE INDEX IF NOT EXISTS idx_reviews_phase ON reviews(review_phase, target_id);
CREATE INDEX IF NOT EXISTS idx_reviews_coaching ON reviews(coaching_session_id);
CREATE INDEX IF NOT EXISTS idx_breakdown_offers_request ON breakdown_offers(request_id);
CREATE INDEX IF NOT EXISTS idx_breakdown_offers_coach ON breakdown_offers(coach_id, status);
CREATE INDEX IF NOT EXISTS idx_breakdown_offers_status ON breakdown_offers(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scouting_budget ON scouting_requests(budget, status);
CREATE INDEX IF NOT EXISTS idx_scouting_visibility ON scouting_requests(visibility, created_at DESC);
