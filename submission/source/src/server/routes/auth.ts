import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env.ts';
import {
	createSession,
	clearSessionCookie,
	destroySession,
	optionalToken,
	requireUser,
	setSessionCookie
} from '../auth/session.ts';
import { hashPassword, validatePasswordComplexity, verifyPassword } from '../auth/passwords.ts';
import {
	consumePasswordResetToken,
	createPasswordResetToken,
	findUserByEmail,
	findUserById,
	recordAuditLog,
	updateUserPassword
} from '../db/queries.ts';
import { toPublicUser } from '../db/map.ts';
import { HttpError } from '../http/errors.ts';

export const authRoutes = new Hono<AppEnv>();

function getClientMeta(c: Context) {
	return {
		ipAddress: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? '127.0.0.1',
		userAgent: c.req.header('user-agent') ?? 'unknown'
	};
}

interface RateLimitEntry {
	attempts: number;
	resetAt: number;
}

const loginAttempts = new Map<string, RateLimitEntry>();
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(key: string): void {
	const now = Date.now();
	const entry = loginAttempts.get(key);
	if (!entry) return;
	if (now > entry.resetAt) {
		loginAttempts.delete(key);
		return;
	}
	if (entry.attempts >= MAX_LOGIN_ATTEMPTS) {
		throw new HttpError(429, 'too_many_requests', 'Too many failed login attempts. Please try again later.');
	}
}

function recordFailedLogin(key: string): void {
	const now = Date.now();
	const entry = loginAttempts.get(key);
	if (!entry || now > entry.resetAt) {
		loginAttempts.set(key, { attempts: 1, resetAt: now + LOGIN_WINDOW_MS });
	} else {
		entry.attempts += 1;
	}
}

function clearFailedLogin(key: string): void {
	loginAttempts.delete(key);
}

authRoutes.post('/login', async (c) => {
	const db = c.get('db');
	const meta = getClientMeta(c);
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		throw new HttpError(400, 'bad_request', 'Request body must be JSON.');
	}
	if (!body || typeof body !== 'object') {
		throw new HttpError(400, 'bad_request', 'Request body must be JSON.');
	}
	const email = 'email' in body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
	const password = 'password' in body && typeof body.password === 'string' ? body.password : '';
	if (!email || !password) {
		throw new HttpError(400, 'bad_request', 'Email and password are required.');
	}

	const clientKey = `${c.req.header('x-forwarded-for') ?? 'local'}:${email}`;
	checkRateLimit(clientKey);

	const user = findUserByEmail(db, email);
	if (!user || !verifyPassword(password, user.password_hash)) {
		recordFailedLogin(clientKey);
		recordAuditLog(db, {
			userId: user ? user.id : null,
			action: 'auth.login_failed',
			targetType: 'user',
			targetId: user ? user.id : null,
			details: { email },
			ipAddress: meta.ipAddress,
			userAgent: meta.userAgent
		});
		throw new HttpError(401, 'unauthenticated', 'Invalid email or password.');
	}

	clearFailedLogin(clientKey);
	const token = createSession(db, user.id);
	setSessionCookie(c, token);

	recordAuditLog(db, {
		userId: user.id,
		action: 'auth.login',
		targetType: 'user',
		targetId: user.id,
		details: { email: user.email, role: user.role },
		ipAddress: meta.ipAddress,
		userAgent: meta.userAgent
	});

	return c.json({ user: toPublicUser(user) });
});

authRoutes.post('/logout', (c) => {
	const db = c.get('db');
	const meta = getClientMeta(c);
	const token = optionalToken(c);
	if (token) {
		destroySession(db, token);
		recordAuditLog(db, {
			action: 'auth.logout',
			targetType: 'session',
			targetId: token.slice(0, 8) + '...',
			ipAddress: meta.ipAddress,
			userAgent: meta.userAgent
		});
	}
	clearSessionCookie(c);
	return c.json({ ok: true });
});

authRoutes.get('/me', (c) => {
	const db = c.get('db');
	const user = requireUser(c, db);
	return c.json({ user: toPublicUser(user) });
});


authRoutes.post('/change-password', async (c) => {
	const db = c.get('db');
	const meta = getClientMeta(c);
	const sessionUser = requireUser(c, db);
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		throw new HttpError(400, 'bad_request', 'Request body must be JSON.');
	}
	if (!body || typeof body !== 'object') {
		throw new HttpError(400, 'bad_request', 'Request body must be JSON.');
	}
	const currentPassword =
		'currentPassword' in body && typeof body.currentPassword === 'string' ? body.currentPassword : '';
	const newPassword = 'newPassword' in body && typeof body.newPassword === 'string' ? body.newPassword : '';

	if (!currentPassword || !newPassword) {
		throw new HttpError(400, 'bad_request', 'Current password and new password are required.');
	}

	const userRow = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(sessionUser.id) as
		| { password_hash: string }
		| undefined;
	if (!userRow || !verifyPassword(currentPassword, userRow.password_hash)) {
		throw new HttpError(401, 'unauthenticated', 'Current password is incorrect.');
	}

	validatePasswordComplexity(newPassword);

	const token = optionalToken(c);
	const newHash = hashPassword(newPassword);
	updateUserPassword(db, sessionUser.id, newHash, token);

	recordAuditLog(db, {
		userId: sessionUser.id,
		action: 'auth.password_change',
		targetType: 'user',
		targetId: sessionUser.id,
		ipAddress: meta.ipAddress,
		userAgent: meta.userAgent
	});

	return c.json({ ok: true, message: 'Password changed successfully.' });
});

authRoutes.post('/admin/reset-token', async (c) => {
	const db = c.get('db');
	const meta = getClientMeta(c);
	const warden = requireUser(c, db);
	if (warden.role !== 'warden') {
		throw new HttpError(403, 'unauthorized', 'Only wardens can generate password reset tokens.');
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		throw new HttpError(400, 'bad_request', 'Request body must be JSON.');
	}
	if (!body || typeof body !== 'object') {
		throw new HttpError(400, 'bad_request', 'Request body must be JSON.');
	}

	const email = 'email' in body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
	const userId = 'userId' in body && typeof body.userId === 'string' ? body.userId.trim() : '';

	if (!email && !userId) {
		throw new HttpError(400, 'bad_request', 'Target user email or userId is required.');
	}

	const targetUser = email ? findUserByEmail(db, email) : findUserById(db, userId);
	if (!targetUser) {
		throw new HttpError(404, 'not_found', 'User not found.');
	}

	const { token, expiresAt } = createPasswordResetToken(db, targetUser.id, warden.id);

	recordAuditLog(db, {
		userId: warden.id,
		action: 'auth.reset_token_created',
		targetType: 'user',
		targetId: targetUser.id,
		details: { targetEmail: targetUser.email },
		ipAddress: meta.ipAddress,
		userAgent: meta.userAgent
	});

	return c.json(
		{
			ok: true,
			token,
			expiresAt,
			targetUser: {
				id: targetUser.id,
				email: targetUser.email,
				name: targetUser.name,
				role: targetUser.role
			}
		},
		201
	);
});

authRoutes.post('/reset-password', async (c) => {
	const db = c.get('db');
	const meta = getClientMeta(c);
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		throw new HttpError(400, 'bad_request', 'Request body must be JSON.');
	}
	if (!body || typeof body !== 'object') {
		throw new HttpError(400, 'bad_request', 'Request body must be JSON.');
	}

	const token = 'token' in body && typeof body.token === 'string' ? body.token.trim() : '';
	const newPassword = 'newPassword' in body && typeof body.newPassword === 'string' ? body.newPassword : '';

	if (!token || !newPassword) {
		throw new HttpError(400, 'bad_request', 'Reset token and new password are required.');
	}

	validatePasswordComplexity(newPassword);

	const newHash = hashPassword(newPassword);
	consumePasswordResetToken(db, token, newHash);

	recordAuditLog(db, {
		action: 'auth.password_reset',
		targetType: 'token',
		targetId: token.slice(0, 8) + '...',
		ipAddress: meta.ipAddress,
		userAgent: meta.userAgent
	});

	return c.json({
		ok: true,
		message: 'Password has been reset successfully. Please log in with your new password.'
	});
});

authRoutes.post('/admin/reset-password', async (c) => {
	const db = c.get('db');
	const meta = getClientMeta(c);
	const warden = requireUser(c, db);
	if (warden.role !== 'warden') {
		throw new HttpError(403, 'unauthorized', 'Only wardens can reset user passwords directly.');
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		throw new HttpError(400, 'bad_request', 'Request body must be JSON.');
	}
	if (!body || typeof body !== 'object') {
		throw new HttpError(400, 'bad_request', 'Request body must be JSON.');
	}

	const email = 'email' in body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
	const userId = 'userId' in body && typeof body.userId === 'string' ? body.userId.trim() : '';
	const newPassword = 'newPassword' in body && typeof body.newPassword === 'string' ? body.newPassword : '';

	if ((!email && !userId) || !newPassword) {
		throw new HttpError(400, 'bad_request', 'Target user (email or userId) and newPassword are required.');
	}

	const targetUser = email ? findUserByEmail(db, email) : findUserById(db, userId);
	if (!targetUser) {
		throw new HttpError(404, 'not_found', 'User not found.');
	}

	validatePasswordComplexity(newPassword);

	const newHash = hashPassword(newPassword);
	updateUserPassword(db, targetUser.id, newHash);

	recordAuditLog(db, {
		userId: warden.id,
		action: 'auth.admin_password_reset',
		targetType: 'user',
		targetId: targetUser.id,
		details: { targetEmail: targetUser.email },
		ipAddress: meta.ipAddress,
		userAgent: meta.userAgent
	});

	return c.json({
		ok: true,
		message: `Password for ${targetUser.email} has been reset successfully.`
	});
});

