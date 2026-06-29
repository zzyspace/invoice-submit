CREATE TABLE IF NOT EXISTS submissions (
  submit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  invoice_type TEXT NOT NULL,
  invoice_title TEXT NOT NULL,
  tax_number TEXT,
  email TEXT NOT NULL,
  contact TEXT,
  note TEXT,
  store_key TEXT,
  attachment_path TEXT NOT NULL,
  attachment_name TEXT NOT NULL,
  attachment_content_type TEXT NOT NULL,
  attachment_size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions(created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_email ON submissions(email);
