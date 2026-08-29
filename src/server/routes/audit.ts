import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { requireUser } from '../auth/session.ts';
import { listAuditLogs } from '../db/queries.ts';
import { toPublicAuditLog } from '../db/map.ts';
import { HttpError } from '../http/errors.ts';

export const auditRoutes = new Hono<AppEnv>();

auditRoutes.get('/', (c) => {
	const db = c.get('db');
	const user = requireUser(c, db);
	if (user.role !== 'warden') {
		throw new HttpError(403, 'unauthorized', 'Only wardens can view audit logs.');
	}

	const query = c.req.query();
	const limit = query.limit ? Number.parseInt(query.limit, 10) : 50;
	const offset = query.offset ? Number.parseInt(query.offset, 10) : 0;
	const action = query.action;
	const targetType = query.targetType;

	const rows = listAuditLogs(db, { limit, offset, action, targetType });
	return c.json({
		data: rows.map(toPublicAuditLog)
	});
});
