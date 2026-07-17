CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER,
  uploaded_by TEXT,
  caption TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  upload_id TEXT,
  created_at INTEGER NOT NULL,
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_status ON photos(status);
CREATE INDEX IF NOT EXISTS idx_created ON photos(created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip_hash TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
