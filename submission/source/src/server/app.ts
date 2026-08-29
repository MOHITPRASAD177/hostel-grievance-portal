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
import { gatewayMiddleware, securityHeadersMiddleware } from './security/gateway.ts';
import { requireUser } from './auth/session.ts';
import { getSecOpsTelemetry } from './security/monitor.ts';

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

	// ── Layer 0: Inject context dependencies ────────────────────────────────
	app.use('*', async (c, next) => {
		c.set('db', options.db);
		c.set('uploadsDir', options.uploadsDir);
		await next();
	});

	// ── Layer 1: Security Headers ────────────────────────────────────────────
	// Applied to every response, including errors.
	app.use('*', securityHeadersMiddleware);

	// ── Layer 2: CORS ────────────────────────────────────────────────────────
	// Whitelist-only origin policy with credentials support.
	app.use(
		'/api/*',
		cors({
			origin: (origin) => getCorsOrigin(origin),
			credentials: true,
			allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
			allowHeaders: ['Content-Type', 'Authorization']
		})
	);

	// ── Layer 3: Security Gateway ─────────────────────────────────────────────
	// IP blocklist, flood detection, body size limit, suspicious pattern scan.
	app.use('/api/*', gatewayMiddleware);

	// ── Error handler ─────────────────────────────────────────────────────────
	app.onError((err, c) => handleError(err, c));

	// ── 404 catch-all ────────────────────────────────────────────────────────
	app.notFound((c) => c.json({ error: 'Not found.', code: 'not_found' }, 404));

	// ── Routes ────────────────────────────────────────────────────────────────
	app.get('/api/health', (c) =>
		c.json({ ok: true, guard: 'GrievanceGuard v1.0 — Layered Authorization & Threat Monitoring' })
	);
	app.route('/api', authRoutes);
	app.route('/api/grievances', grievanceRoutes);
	app.route('/api/attachments', attachmentRoutes);
	app.route('/api/notifications', notificationRoutes);
	app.route('/api/admin/audit-logs', auditRoutes);

	app.get('/api/admin/security/telemetry', (c) => {
		const db = c.get('db');
		const user = requireUser(c, db);
		if (user.role !== 'warden') {
			throw new HttpError(403, 'unauthorized', 'Only wardens can access SecOps telemetry.');
		}
		return c.json({ data: getSecOpsTelemetry(db) });
	});

	app.all('/api/*', () => {
		throw new HttpError(404, 'not_found', 'Not found.');
	});

	return app;
}
