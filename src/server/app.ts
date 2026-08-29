import { Hono } from 'hono';
import type { Database } from 'better-sqlite3';
import type { AppEnv } from './env.ts';
import { handleError, HttpError } from './http/errors.ts';
import { authRoutes } from './routes/auth.ts';
import { grievanceRoutes } from './routes/grievances.ts';
import { attachmentRoutes } from './routes/attachments.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { auditRoutes } from './routes/audit.ts';
import { cors } from 'hono/cors';

export type CreateAppOptions = {
	db: Database;
	uploadsDir: string;
};

const DEFAULT_ALLOWED_ORIGINS = new Set([
	'http://localhost:5173',
	'http://127.0.0.1:5173',
	'http://localhost:4173',
	'http://127.0.0.1:4173',
	'http://localhost:3001',
	'http://127.0.0.1:3001'
]);

function getCorsOrigin(origin: string | undefined): string {
	if (!origin) return '';
	if (process.env.ALLOWED_ORIGINS) {
		const envOrigins = process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
		if (envOrigins.includes(origin)) return origin;
	}
	if (DEFAULT_ALLOWED_ORIGINS.has(origin)) {
		return origin;
	}
	return '';
}

export function createApp(options: CreateAppOptions) {
	const app = new Hono<AppEnv>();

	app.use('*', async (c, next) => {
		c.set('db', options.db);
		c.set('uploadsDir', options.uploadsDir);
		// SEC-04 / SEC-11: Security headers
		c.header('X-Content-Type-Options', 'nosniff');
		c.header('X-Frame-Options', 'DENY');
		c.header('X-XSS-Protection', '0'); // Disable legacy XSS auditor (can cause issues); CSP is the modern approach
		c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
		c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
		await next();
	});

	app.use(
		'/api/*',
		cors({
			origin: (origin) => getCorsOrigin(origin),
			credentials: true,
			allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
			allowHeaders: ['Content-Type', 'Authorization']
		})
	);

	app.onError((err, c) => handleError(err, c));

	app.notFound((c) => c.json({ error: 'Not found.', code: 'not_found' }, 404));

	app.get('/api/health', (c) => c.json({ ok: true }));
	app.route('/api', authRoutes);
	app.route('/api/grievances', grievanceRoutes);
	app.route('/api/attachments', attachmentRoutes);
	app.route('/api/notifications', notificationRoutes);
	app.route('/api/admin/audit-logs', auditRoutes);

	app.all('/api/*', () => {
		throw new HttpError(404, 'not_found', 'Not found.');
	});

	return app;
}

