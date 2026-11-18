CREATE TABLE IF NOT EXISTS idempotency_requests (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  request_hash TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  response_status INTEGER,
  response_body JSONB,
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_requests_completed
  ON idempotency_requests(completed_at)
  WHERE completed_at IS NOT NULL;
