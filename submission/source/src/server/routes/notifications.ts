import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { requireUser } from '../auth/session.ts';
import {
	listNotificationsForUser,
	markAllNotificationsRead,
	markNotificationRead,
	unreadNotificationCount
} from '../db/queries.ts';
import { toPublicNotification } from '../db/map.ts';

export const notificationRoutes = new Hono<AppEnv>();

notificationRoutes.get('/', (c) => {
	const db = c.get('db');
	const user = requireUser(c, db);
	const rows = listNotificationsForUser(db, user.id);
	const unreadCount = unreadNotificationCount(db, user.id);
	return c.json({
		data: rows.map(toPublicNotification),
		unreadCount
	});
});

notificationRoutes.patch('/:id/read', (c) => {
	const db = c.get('db');
	const user = requireUser(c, db);
	markNotificationRead(db, c.req.param('id'), user.id);
	return c.json({ ok: true });
});

notificationRoutes.post('/:id/read', (c) => {
	const db = c.get('db');
	const user = requireUser(c, db);
	markNotificationRead(db, c.req.param('id'), user.id);
	return c.json({ ok: true });
});

notificationRoutes.post('/read-all', (c) => {
	const db = c.get('db');
	const user = requireUser(c, db);
	markAllNotificationsRead(db, user.id);
	return c.json({ ok: true });
});
