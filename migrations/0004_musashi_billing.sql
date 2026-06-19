CREATE TABLE IF NOT EXISTS musashi_stripe_customers (
  user_id TEXT PRIMARY KEY,
  stripe_customer_id TEXT UNIQUE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES musashi_users (id) ON DELETE CASCADE
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
  current_period_end DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES musashi_users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_musashi_stripe_subscriptions_user_id ON musashi_stripe_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_musashi_stripe_subscriptions_customer_id ON musashi_stripe_subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_musashi_stripe_subscriptions_status ON musashi_stripe_subscriptions(status);
