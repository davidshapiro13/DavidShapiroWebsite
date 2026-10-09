-- Deliberately excludes names, emails, addresses, and payment card information.
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  stripe_session_id TEXT UNIQUE,
  printify_order_id TEXT UNIQUE,
  shop_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id INTEGER NOT NULL,
  unit_amount INTEGER NOT NULL CHECK (unit_amount > 0),
  shipping_amount INTEGER NOT NULL CHECK (shipping_amount >= 0),
  countries TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  state TEXT NOT NULL DEFAULT 'checkout',
  live INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX orders_pending ON orders(state, next_attempt, lease_until);
