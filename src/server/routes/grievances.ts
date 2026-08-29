import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env.ts';
import { requireUser } from '../auth/session.ts';
import {
	archiveGrievance,
	assembleGrievance,
	assertCanViewGrievance,
	createNotification,
	findUserById,
	listAllGrievanceRows,
	listCommentRows,
	listGrievanceRowsForStudent,
	nextAttachmentId,
	nextCommentId,
	nextGrievanceId,
	recordAuditLog,
	requireGrievance,
	softDeleteGrievance,
	touchGrievance
} from '../db/queries.ts';
import type { CommentRow, AttachmentRow } from '../types/index.ts';
import { toPublicAttachment, toPublicComment, toPublicUser } from '../db/map.ts';
import { HttpError } from '../http/errors.ts';
import { parseCategory, statusToDb, statusToUi } from '../http/status.ts';
import {
	bufferFromUpload,
	newStoredName,
	originalBasename,
	writeStoredFile
} from '../storage/attachments.ts';

function nowIso(): string {
	return new Date().toISOString();
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function getClientMeta(c: Context) {
	return {
		ipAddress: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? '127.0.0.1',
		userAgent: c.req.header('user-agent') ?? 'unknown'
	};
}

export const grievanceRoutes = new Hono<AppEnv>();

grievanceRoutes.get('/', (c) => {
	const db = c.get('db');
	const user = requireUser(c, db);
	const query = c.req.query();
	const includeArchived = query.include_archived === 'true';
	const includeDeleted = query.include_deleted === 'true';

	const rows =
		user.role === 'warden'
			? listAllGrievanceRows(db, { includeArchived, includeDeleted })
			: listGrievanceRowsForStudent(db, user.id, { includeArchived, includeDeleted });
	return c.json({
		data: rows.map((row) => assembleGrievance(db, row))
	});
});

grievanceRoutes.post('/', async (c) => {
	const db = c.get('db');
	const uploadsDir = c.get('uploadsDir');
	const meta = getClientMeta(c);
	const user = requireUser(c, db);
	if (user.role !== 'student') {
		throw new HttpError(403, 'unauthorized', 'Only students can file grievances.');
	}

	const contentType = c.req.header('content-type') ?? '';
	let title = '';
	let category = '';
	let description = '';
	let upload: File | undefined;

	if (contentType.includes('multipart/form-data')) {
		const body = await c.req.parseBody();
		title = readString(body.title) ?? '';
		category = readString(body.category) ?? '';
		description = readString(body.description) ?? '';
		if (body.file instanceof File) upload = body.file;
		else if (body.attachment instanceof File) upload = body.attachment;
	} else {
		let json: unknown;
		try {
			json = await c.req.json();
		} catch {
			throw new HttpError(400, 'bad_request', 'Request body must be JSON or multipart form data.');
		}
		if (!json || typeof json !== 'object') {
			throw new HttpError(400, 'bad_request', 'Request body must be JSON or multipart form data.');
		}
		title = readString('title' in json ? json.title : undefined) ?? '';
		category = readString('category' in json ? json.category : undefined) ?? '';
		description = readString('description' in json ? json.description : undefined) ?? '';
	}

	title = title.trim();
	description = description.trim();
	if (title.length < 5) {
		throw new HttpError(400, 'bad_request', 'Title must be at least 5 characters.');
	}
	if (title.length > 200) {
		throw new HttpError(400, 'bad_request', 'Title must be 200 characters or fewer.');
	}
	if (description.length < 20) {
		throw new HttpError(400, 'bad_request', 'Description must be at least 20 characters.');
	}
	if (description.length > 5_000) {
		throw new HttpError(400, 'bad_request', 'Description must be 5,000 characters or fewer.');
	}
	const parsedCategory = parseCategory(category);

	const id = nextGrievanceId(db);
	const ts = nowIso();
	db.prepare(
		`INSERT INTO grievances (id, student_id, title, category, description, status, created_at, updated_at, deleted_at, archived_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, NULL, NULL)`
	).run(id, user.id, title, parsedCategory, description, ts, ts);

	recordAuditLog(db, {
		userId: user.id,
		action: 'grievance.create',
		targetType: 'grievance',
		targetId: id,
		details: { title, category: parsedCategory },
		ipAddress: meta.ipAddress,
		userAgent: meta.userAgent
	});

	if (upload) {
		const bytes = await bufferFromUpload(upload);
		const stored = newStoredName(upload.type);
		writeStoredFile(uploadsDir, stored, bytes);
		const attachmentId = nextAttachmentId(db);
		db.prepare(
			`INSERT INTO attachments (id, grievance_id, original_filename, stored_filename, mime_type, size_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run(
			attachmentId,
			id,
			originalBasename(upload.name),
			stored,
			upload.type,
			bytes.byteLength,
			ts
		);

		recordAuditLog(db, {
			userId: user.id,
			action: 'attachment.upload',
			targetType: 'attachment',
			targetId: attachmentId,
			details: { grievanceId: id, filename: originalBasename(upload.name), mimeType: upload.type },
			ipAddress: meta.ipAddress,
			userAgent: meta.userAgent
		});
	}

	return c.json({ data: assembleGrievance(db, requireGrievance(db, id)) }, 201);
});

grievanceRoutes.get('/:id/comments', (c) => {
	const db = c.get('db');
	const user = requireUser(c, db);
	const row = requireGrievance(db, c.req.param('id'));
	assertCanViewGrievance(user, row);
	const comments = listCommentRows(db, row.id).map((comment) => {
		const authorRow = findUserById(db, comment.author_id);
		if (!authorRow) {
			throw new HttpError(500, 'internal', 'Internal server error.');
		}
		return toPublicComment(comment, toPublicUser(authorRow));
	});
	return c.json({ data: comments });
});

grievanceRoutes.post('/:id/comments', async (c) => {
	const db = c.get('db');
	const meta = getClientMeta(c);
	const user = requireUser(c, db);
	const row = requireGrievance(db, c.req.param('id'));
	assertCanViewGrievance(user, row);

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		throw new HttpError(400, 'bad_request', 'JSON body is required.');
	}
	const text =
		body && typeof body === 'object' && 'body' in body && typeof body.body === 'string'
			? body.body.trim()
			: '';
	if (!text) {
		throw new HttpError(400, 'bad_request', 'Comment cannot be empty.');
	}
	if (text.length > 10_000) {
		throw new HttpError(400, 'bad_request', 'Comment must be 10,000 characters or fewer.');
	}

	const id = nextCommentId(db);
	const ts = nowIso();
	db.prepare(
		`INSERT INTO comments (id, grievance_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)`
	).run(id, row.id, user.id, text, ts);
	touchGrievance(db, row.id, ts);

	recordAuditLog(db, {
		userId: user.id,
		action: 'comment.create',
		targetType: 'comment',
		targetId: id,
		details: { grievanceId: row.id },
		ipAddress: meta.ipAddress,
		userAgent: meta.userAgent
	});

	// If warden commented, notify the student
	if (user.role === 'warden') {
		createNotification(db, {
			userId: row.student_id,
			grievanceId: row.id,
			title: 'New Comment from Warden',
			message: `${user.name} added a comment on your grievance "${row.title}".`
		});
	}

	const author = findUserById(db, user.id);
	if (!author) {
		throw new HttpError(500, 'internal', 'Internal server error.');
	}
	const commentRow = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as CommentRow;
	return c.json({ data: toPublicComment(commentRow, toPublicUser(author)) }, 201);
});

grievanceRoutes.post('/:id/attachments', async (c) => {
	const db = c.get('db');
	const meta = getClientMeta(c);
	const user = requireUser(c, db);
	const row = requireGrievance(db, c.req.param('id'));
	if (user.role !== 'student' || row.student_id !== user.id) {
		throw new HttpError(403, 'unauthorized', 'Only the student owner can add attachments.');
	}
	if (row.status === 'resolved') {
		throw new HttpError(409, 'conflict', 'Resolved grievances cannot be edited.');
	}
	if (row.deleted_at) {
		throw new HttpError(409, 'conflict', 'Withdrawn grievances cannot be edited.');
	}

	const body = await c.req.parseBody();
	const upload = body.file instanceof File ? body.file : body.attachment instanceof File ? body.attachment : undefined;
	if (!upload) {
		throw new HttpError(400, 'bad_request', 'A file field named file is required.');
	}

	const bytes = await bufferFromUpload(upload);
	const stored = newStoredName(upload.type);
	const ts = nowIso();
	writeStoredFile(c.get('uploadsDir'), stored, bytes);
	const id = nextAttachmentId(db);
	db.prepare(
		`INSERT INTO attachments (id, grievance_id, original_filename, stored_filename, mime_type, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
	).run(id, row.id, originalBasename(upload.name), stored, upload.type, bytes.byteLength, ts);
	touchGrievance(db, row.id, ts);

	recordAuditLog(db, {
		userId: user.id,
		action: 'attachment.upload',
		targetType: 'attachment',
		targetId: id,
		details: { grievanceId: row.id, filename: originalBasename(upload.name), mimeType: upload.type },
		ipAddress: meta.ipAddress,
		userAgent: meta.userAgent
	});

	const saved = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow;
	return c.json({ data: toPublicAttachment(saved) }, 201);
});

grievanceRoutes.get('/:id', (c) => {
	const db = c.get('db');
	const user = requireUser(c, db);
	const row = requireGrievance(db, c.req.param('id'));
	assertCanViewGrievance(user, row);
	return c.json({ data: assembleGrievance(db, row) });
});

grievanceRoutes.patch('/:id', async (c) => {
	const db = c.get('db');
	const meta = getClientMeta(c);
	const user = requireUser(c, db);
	const row = requireGrievance(db, c.req.param('id'));
	assertCanViewGrievance(user, row);

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		throw new HttpError(400, 'bad_request', 'Request body must be JSON.');
	}
	if (!body || typeof body !== 'object') {
		throw new HttpError(400, 'bad_request', 'Request body must be JSON.');
	}

	const title = 'title' in body ? body.title : undefined;
	const description = 'description' in body ? body.description : undefined;
	const category = 'category' in body ? body.category : undefined;
	const status = 'status' in body ? body.status : undefined;
	const wantsContent = title !== undefined || description !== undefined || category !== undefined;
	const wantsStatus = status !== undefined;

	if (!wantsContent && !wantsStatus) {
		throw new HttpError(400, 'bad_request', 'No updatable fields were provided.');
	}

	switch (user.role) {
		case 'student': {
			if (row.student_id !== user.id) {
				throw new HttpError(403, 'unauthorized', 'Only the student owner can edit this grievance.');
			}
			if (row.status === 'resolved') {
				throw new HttpError(409, 'conflict', 'Resolved grievances cannot be edited.');
			}
			if (row.deleted_at) {
				throw new HttpError(409, 'conflict', 'Withdrawn grievances cannot be edited.');
			}
			if (wantsStatus) {
				throw new HttpError(403, 'unauthorized', 'Students cannot edit grievance status.');
			}
			let nextTitle = row.title;
			let nextDescription = row.description;
			let nextCategory = row.category;
			if (title !== undefined) {
				if (typeof title !== 'string' || title.trim().length < 5) {
					throw new HttpError(400, 'bad_request', 'Title must be at least 5 characters.');
				}
				if (title.trim().length > 200) {
					throw new HttpError(400, 'bad_request', 'Title must be 200 characters or fewer.');
				}
				nextTitle = title.trim();
			}
			if (description !== undefined) {
				if (typeof description !== 'string' || description.trim().length < 20) {
					throw new HttpError(400, 'bad_request', 'Description must be at least 20 characters.');
				}
				if (description.trim().length > 5_000) {
					throw new HttpError(400, 'bad_request', 'Description must be 5,000 characters or fewer.');
				}
				nextDescription = description.trim();
			}
			if (category !== undefined) {
				if (typeof category !== 'string') {
					throw new HttpError(400, 'bad_request', 'Invalid grievance category.');
				}
				nextCategory = parseCategory(category);
			}
			const ts = nowIso();
			db.prepare(
				'UPDATE grievances SET title = ?, description = ?, category = ?, updated_at = ? WHERE id = ?'
			).run(nextTitle, nextDescription, nextCategory, ts, row.id);

			recordAuditLog(db, {
				userId: user.id,
				action: 'grievance.edit',
				targetType: 'grievance',
				targetId: row.id,
				details: { title: nextTitle, category: nextCategory },
				ipAddress: meta.ipAddress,
				userAgent: meta.userAgent
			});
			break;
		}
		case 'warden': {
			if (wantsContent) {
				throw new HttpError(403, 'unauthorized', 'Wardens cannot edit grievance content.');
			}
			if (typeof status !== 'string') {
				throw new HttpError(400, 'bad_request', 'Invalid grievance status.');
			}
			const nextStatus = statusToDb(status);
			const ts = nowIso();
			db.prepare('UPDATE grievances SET status = ?, updated_at = ? WHERE id = ?').run(
				nextStatus,
				ts,
				row.id
			);

			recordAuditLog(db, {
				userId: user.id,
				action: 'grievance.status_change',
				targetType: 'grievance',
				targetId: row.id,
				details: { oldStatus: row.status, newStatus: nextStatus },
				ipAddress: meta.ipAddress,
				userAgent: meta.userAgent
			});

			// Notify student of status change
			createNotification(db, {
				userId: row.student_id,
				grievanceId: row.id,
				title: 'Grievance Status Updated',
				message: `Your grievance "${row.title}" status has been changed to "${statusToUi(nextStatus)}".`
			});
			break;
		}
		default: {
			const _exhaustive: never = user.role;
			throw new HttpError(500, 'internal', 'Internal server error.');
			void _exhaustive;
		}
	}

	return c.json({ data: assembleGrievance(db, requireGrievance(db, row.id)) });
});

grievanceRoutes.delete('/:id', (c) => {
	const db = c.get('db');
	const meta = getClientMeta(c);
	const user = requireUser(c, db);
	const row = requireGrievance(db, c.req.param('id'));

	if (user.role === 'student') {
		if (row.student_id !== user.id) {
			throw new HttpError(403, 'unauthorized', 'Only the student owner can withdraw this grievance.');
		}
		if (row.status === 'resolved') {
			throw new HttpError(409, 'conflict', 'Resolved grievances cannot be withdrawn.');
		}
		softDeleteGrievance(db, row.id);
		recordAuditLog(db, {
			userId: user.id,
			action: 'grievance.withdraw',
			targetType: 'grievance',
			targetId: row.id,
			details: { title: row.title },
			ipAddress: meta.ipAddress,
			userAgent: meta.userAgent
		});
		return c.json({ ok: true, message: 'Grievance withdrawn successfully.' });
	}

	if (user.role === 'warden') {
		softDeleteGrievance(db, row.id);
		recordAuditLog(db, {
			userId: user.id,
			action: 'grievance.delete',
			targetType: 'grievance',
			targetId: row.id,
			details: { title: row.title },
			ipAddress: meta.ipAddress,
			userAgent: meta.userAgent
		});
		return c.json({ ok: true, message: 'Grievance removed successfully.' });
	}

	throw new HttpError(403, 'unauthorized', 'Unauthorized.');
});

grievanceRoutes.post('/:id/withdraw', (c) => {
	const db = c.get('db');
	const meta = getClientMeta(c);
	const user = requireUser(c, db);
	const row = requireGrievance(db, c.req.param('id'));

	if (user.role !== 'student' || row.student_id !== user.id) {
		throw new HttpError(403, 'unauthorized', 'Only the student owner can withdraw this grievance.');
	}
	if (row.status === 'resolved') {
		throw new HttpError(409, 'conflict', 'Resolved grievances cannot be withdrawn.');
	}
	softDeleteGrievance(db, row.id);
	recordAuditLog(db, {
		userId: user.id,
		action: 'grievance.withdraw',
		targetType: 'grievance',
		targetId: row.id,
		details: { title: row.title },
		ipAddress: meta.ipAddress,
		userAgent: meta.userAgent
	});
	return c.json({ ok: true, message: 'Grievance withdrawn successfully.' });
});

grievanceRoutes.post('/:id/archive', (c) => {
	const db = c.get('db');
	const meta = getClientMeta(c);
	const user = requireUser(c, db);
	if (user.role !== 'warden') {
		throw new HttpError(403, 'unauthorized', 'Only wardens can archive grievances.');
	}
	const row = requireGrievance(db, c.req.param('id'));
	if (row.status !== 'resolved') {
		throw new HttpError(409, 'conflict', 'Only resolved grievances can be archived.');
	}

	archiveGrievance(db, row.id);
	recordAuditLog(db, {
		userId: user.id,
		action: 'grievance.archive',
		targetType: 'grievance',
		targetId: row.id,
		details: { title: row.title },
		ipAddress: meta.ipAddress,
		userAgent: meta.userAgent
	});
	return c.json({ ok: true, message: 'Grievance archived successfully.' });
});
