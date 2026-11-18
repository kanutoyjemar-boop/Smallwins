CREATE TABLE IF NOT EXISTS sample_data_sets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  records JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(records) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
