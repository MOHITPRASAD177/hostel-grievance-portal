import type { Database } from 'better-sqlite3';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'warden')),
  room TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grievances (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  grievance_id TEXT NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  grievance_id TEXT NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grievance_id TEXT REFERENCES grievances(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`;

export function applySchema(db: Database): void {
	db.exec('PRAGMA foreign_keys = ON;');
	db.exec(SCHEMA_SQL);

	// Ensure columns exist on existing databases
	const columns = db.prepare(`PRAGMA table_info(grievances)`).all() as { name: string }[];
	const columnNames = new Set(columns.map((c) => c.name));
	if (!columnNames.has('deleted_at')) {
		db.exec('ALTER TABLE grievances ADD COLUMN deleted_at TEXT;');
	}
	if (!columnNames.has('archived_at')) {
		db.exec('ALTER TABLE grievances ADD COLUMN archived_at TEXT;');
	}

	db.exec('CREATE INDEX IF NOT EXISTS idx_grievances_student ON grievances(student_id);');
	db.exec('CREATE INDEX IF NOT EXISTS idx_grievances_deleted ON grievances(deleted_at);');
	db.exec('CREATE INDEX IF NOT EXISTS idx_comments_grievance ON comments(grievance_id);');
	db.exec('CREATE INDEX IF NOT EXISTS idx_attachments_grievance ON attachments(grievance_id);');
	db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);');
	db.exec('CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_reset_tokens(user_id);');
	db.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);');
	db.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);');
	db.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);');
	db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);');
	db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);');
}

