import { randomBytes } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { HttpError } from '../http/errors.ts';
import type {
	AttachmentRow,
	AuditLogRow,
	CommentRow,
	GrievanceRow,
	NotificationRow,
	PasswordResetTokenRow,
	PublicGrievance,
	SessionUser,
	UserRow
} from '../types/index.ts';
import { toPublicAttachment, toPublicComment, toPublicGrievance, toPublicUser } from './map.ts';

export function findUserByEmail(db: Database, email: string): UserRow | undefined {
	return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
}

export function findUserById(db: Database, id: string): UserRow | undefined {
	return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function userCount(db: Database): number {
	const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
	return row.n;
}

export function findGrievanceRow(db: Database, id: string): GrievanceRow | undefined {
	return db.prepare('SELECT * FROM grievances WHERE id = ?').get(id) as GrievanceRow | undefined;
}

export function listGrievanceRowsForStudent(
	db: Database,
	studentId: string,
	options?: { includeDeleted?: boolean; includeArchived?: boolean }
): GrievanceRow[] {
	if (options?.includeDeleted && options?.includeArchived) {
		return db
			.prepare('SELECT * FROM grievances WHERE student_id = ? ORDER BY created_at DESC')
			.all(studentId) as GrievanceRow[];
	}
	if (options?.includeDeleted) {
		return db
			.prepare('SELECT * FROM grievances WHERE student_id = ? AND archived_at IS NULL ORDER BY created_at DESC')
			.all(studentId) as GrievanceRow[];
	}
	if (options?.includeArchived) {
		return db
			.prepare('SELECT * FROM grievances WHERE student_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
			.all(studentId) as GrievanceRow[];
	}
	return db
		.prepare(
			'SELECT * FROM grievances WHERE student_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY created_at DESC'
		)
		.all(studentId) as GrievanceRow[];
}

export function listAllGrievanceRows(
	db: Database,
	options?: { includeDeleted?: boolean; includeArchived?: boolean }
): GrievanceRow[] {
	if (options?.includeDeleted && options?.includeArchived) {
		return db.prepare('SELECT * FROM grievances ORDER BY created_at DESC').all() as GrievanceRow[];
	}
	if (options?.includeDeleted) {
		return db
			.prepare('SELECT * FROM grievances WHERE archived_at IS NULL ORDER BY created_at DESC')
			.all() as GrievanceRow[];
	}
	if (options?.includeArchived) {
		return db
			.prepare('SELECT * FROM grievances WHERE deleted_at IS NULL ORDER BY created_at DESC')
			.all() as GrievanceRow[];
	}
	return db
		.prepare(
			'SELECT * FROM grievances WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY created_at DESC'
		)
		.all() as GrievanceRow[];
}

export function listCommentRows(db: Database, grievanceId: string): CommentRow[] {
	return db
		.prepare('SELECT * FROM comments WHERE grievance_id = ? ORDER BY created_at ASC')
		.all(grievanceId) as CommentRow[];
}

export function listAttachmentRows(db: Database, grievanceId: string): AttachmentRow[] {
	return db
		.prepare('SELECT * FROM attachments WHERE grievance_id = ? ORDER BY created_at ASC')
		.all(grievanceId) as AttachmentRow[];
}

export function findAttachmentRow(db: Database, id: string): AttachmentRow | undefined {
	return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined;
}

export function assembleGrievance(db: Database, row: GrievanceRow): PublicGrievance {
	const studentRow = findUserById(db, row.student_id);
	if (!studentRow) {
		throw new HttpError(500, 'internal', 'Internal server error.');
	}
	const student = toPublicUser(studentRow);
	const attachments = listAttachmentRows(db, row.id).map(toPublicAttachment);
	const comments = listCommentRows(db, row.id).map((comment) => {
		const authorRow = findUserById(db, comment.author_id);
		if (!authorRow) {
			throw new HttpError(500, 'internal', 'Internal server error.');
		}
		return toPublicComment(comment, toPublicUser(authorRow));
	});
	return toPublicGrievance(row, student, attachments, comments);
}

export function requireGrievance(db: Database, id: string): GrievanceRow {
	const row = findGrievanceRow(db, id);
	if (!row) {
		throw new HttpError(404, 'not_found', 'Grievance was not found.');
	}
	return row;
}

export function assertCanViewGrievance(user: SessionUser, row: GrievanceRow): void {
	switch (user.role) {
		case 'warden':
			return;
		case 'student':
			if (row.student_id !== user.id) {
				throw new HttpError(403, 'unauthorized', 'You cannot access this grievance.');
			}
			return;
		default: {
			const _exhaustive: never = user.role;
			throw new HttpError(500, 'internal', 'Internal server error.');
			void _exhaustive;
		}
	}
}

function nextPrefixedId(db: Database, table: 'grievances' | 'comments' | 'attachments', prefix: string): string {
	const rows = db.prepare(`SELECT id FROM ${table}`).all() as { id: string }[];
	let max = 0;
	for (const row of rows) {
		if (!row.id.startsWith(prefix)) continue;
		const n = Number.parseInt(row.id.slice(prefix.length), 10);
		if (!Number.isNaN(n) && n > max) max = n;
	}
	return `${prefix}${String(max + 1).padStart(prefix === 'GRV-' ? 4 : 0, '0')}`;
}

export function nextGrievanceId(db: Database): string {
	return nextPrefixedId(db, 'grievances', 'GRV-');
}

export function nextCommentId(db: Database): string {
	const rows = db.prepare('SELECT id FROM comments').all() as { id: string }[];
	let max = 0;
	for (const row of rows) {
		const match = /^cmt-(\d+)$/.exec(row.id);
		if (!match) continue;
		const n = Number.parseInt(match[1], 10);
		if (n > max) max = n;
	}
	return `cmt-${max + 1}`;
}

export function nextAttachmentId(db: Database): string {
	const rows = db.prepare('SELECT id FROM attachments').all() as { id: string }[];
	let max = 0;
	for (const row of rows) {
		const match = /^att-(\d+)$/.exec(row.id);
		if (!match) continue;
		const n = Number.parseInt(match[1], 10);
		if (n > max) max = n;
	}
	return `att-${max + 1}`;
}

export function touchGrievance(db: Database, id: string, updatedAt: string): void {
	db.prepare('UPDATE grievances SET updated_at = ? WHERE id = ?').run(updatedAt, id);
}

export function softDeleteGrievance(db: Database, id: string): void {
	const now = new Date().toISOString();
	db.prepare('UPDATE grievances SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
}

export function archiveGrievance(db: Database, id: string): void {
	const now = new Date().toISOString();
	db.prepare('UPDATE grievances SET archived_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
}

export function createPasswordResetToken(
	db: Database,
	userId: string,
	createdBy: string,
	ttlSeconds = 3600
): { token: string; expiresAt: string } {
	const token = randomBytes(32).toString('hex');
	const now = new Date();
	const expires = new Date(now.getTime() + ttlSeconds * 1000);
	const nowIso = now.toISOString();
	const expiresIso = expires.toISOString();

	// Invalidate any previously unused reset tokens for this user
	db.prepare(
		`UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`
	).run(nowIso, userId);

	db.prepare(
		`INSERT INTO password_reset_tokens (token, user_id, created_by, created_at, expires_at, used_at)
     VALUES (?, ?, ?, ?, ?, NULL)`
	).run(token, userId, createdBy, nowIso, expiresIso);

	return { token, expiresAt: expiresIso };
}

export function findValidPasswordResetToken(
	db: Database,
	token: string
): PasswordResetTokenRow | undefined {
	const row = db
		.prepare(`SELECT * FROM password_reset_tokens WHERE token = ?`)
		.get(token) as PasswordResetTokenRow | undefined;
	if (!row) return undefined;
	if (row.used_at !== null) return undefined;
	if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
	return row;
}

export function consumePasswordResetToken(
	db: Database,
	token: string,
	newPasswordHash: string
): void {
	const validToken = findValidPasswordResetToken(db, token);
	if (!validToken) {
		throw new HttpError(400, 'bad_request', 'Invalid or expired password reset token.');
	}

	const nowIso = new Date().toISOString();
	db.transaction(() => {
		// Mark token as used
		db.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE token = ?`).run(nowIso, token);
		// Update password
		db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(newPasswordHash, validToken.user_id);
		// Revoke all active sessions for this user so they must log in with new password
		db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(validToken.user_id);
	})();
}

export function updateUserPassword(
	db: Database,
	userId: string,
	newPasswordHash: string,
	keepSessionToken?: string
): void {
	db.transaction(() => {
		db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(newPasswordHash, userId);
		if (keepSessionToken) {
			db.prepare(`DELETE FROM sessions WHERE user_id = ? AND token != ?`).run(userId, keepSessionToken);
		} else {
			db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
		}
	})();
}

export function recordAuditLog(
	db: Database,
	params: {
		userId?: string | null;
		action: string;
		targetType: string;
		targetId?: string | null;
		details?: Record<string, unknown> | string | null;
		ipAddress?: string | null;
		userAgent?: string | null;
	}
): void {
	const id = randomBytes(16).toString('hex');
	const ts = new Date().toISOString();
	const detailsJson =
		params.details == null
			? null
			: typeof params.details === 'string'
				? params.details
				: JSON.stringify(params.details);

	db.prepare(
		`INSERT INTO audit_logs (id, user_id, action, target_type, target_id, details, ip_address, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		id,
		params.userId ?? null,
		params.action,
		params.targetType,
		params.targetId ?? null,
		detailsJson,
		params.ipAddress ?? null,
		params.userAgent ?? null,
		ts
	);
}

export function listAuditLogs(
	db: Database,
	options?: { limit?: number; offset?: number; action?: string; targetType?: string }
): AuditLogRow[] {
	const limit = Math.min(options?.limit ?? 50, 100);
	const offset = options?.offset ?? 0;

	if (options?.action && options?.targetType) {
		return db
			.prepare(
				`SELECT * FROM audit_logs WHERE action = ? AND target_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
			)
			.all(options.action, options.targetType, limit, offset) as AuditLogRow[];
	}
	if (options?.action) {
		return db
			.prepare(`SELECT * FROM audit_logs WHERE action = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`)
			.all(options.action, limit, offset) as AuditLogRow[];
	}
	if (options?.targetType) {
		return db
			.prepare(
				`SELECT * FROM audit_logs WHERE target_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
			)
			.all(options.targetType, limit, offset) as AuditLogRow[];
	}
	return db
		.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?`)
		.all(limit, offset) as AuditLogRow[];
}

export function createNotification(
	db: Database,
	params: {
		userId: string;
		grievanceId?: string | null;
		title: string;
		message: string;
	}
): NotificationRow {
	const id = `notif-${randomBytes(12).toString('hex')}`;
	const ts = new Date().toISOString();
	db.prepare(
		`INSERT INTO notifications (id, user_id, grievance_id, title, message, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
	).run(id, params.userId, params.grievanceId ?? null, params.title, params.message, ts);

	// Also simulate push / email notification dispatch log
	console.log(`[Notification Dispatch] To user ${params.userId} (${params.title}): ${params.message}`);

	return db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as NotificationRow;
}

export function listNotificationsForUser(
	db: Database,
	userId: string,
	limit = 50
): NotificationRow[] {
	return db
		.prepare(
			`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
		)
		.all(userId, Math.min(limit, 100)) as NotificationRow[];
}

export function markNotificationRead(db: Database, id: string, userId: string): void {
	db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`).run(id, userId);
}

export function markAllNotificationsRead(db: Database, userId: string): void {
	db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(userId);
}

export function unreadNotificationCount(db: Database, userId: string): number {
	const row = db
		.prepare(`SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0`)
		.get(userId) as { count: number };
	return row.count;
}


