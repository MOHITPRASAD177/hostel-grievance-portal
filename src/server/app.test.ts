import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { openDatabase } from './db/connection.ts';
import { seedDatabase } from './db/seed.ts';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

function cookieHeader(res: Response): string {
	const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
	const list = anyHeaders.getSetCookie?.() ?? [];
	if (list.length > 0) {
		return list.map((v) => v.split(';')[0]).join('; ');
	}
	const raw = res.headers.get('set-cookie');
	return raw ? raw.split(';')[0] : '';
}

async function login(app: ReturnType<typeof createApp>, email: string, password: string) {
	const res = await app.request('/api/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password })
	});
	const json = await res.json();
	return { res, json, cookie: cookieHeader(res) };
}

describe('HostelGrievance API baseline', () => {
	let dir: string;
	let app: ReturnType<typeof createApp>;
	let db: ReturnType<typeof openDatabase>;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'hg-api-'));
		db = openDatabase(join(dir, 'hostel.db'));
		const uploadDir = join(dir, 'uploads');
		seedDatabase(db, uploadDir);
		app = createApp({ db, uploadsDir: uploadDir });
	});

	afterEach(() => {
		db.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('login works for dummy student and warden accounts', async () => {
		const student = await login(app, 'student@example.test', 'student123');
		expect(student.res.status).toBe(200);
		expect(student.json.user.email).toBe('student@example.test');
		expect(student.json.user.role).toBe('student');
		expect(student.json.user.password).toBeUndefined();
		expect(student.json.user.password_hash).toBeUndefined();
		expect(student.cookie).toContain('hg_session=');

		const warden = await login(app, 'warden@example.test', 'warden123');
		expect(warden.res.status).toBe(200);
		expect(warden.json.user.role).toBe('warden');
	});

	it('rejects invalid credentials', async () => {
		const bad = await login(app, 'student@example.test', 'wrong');
		expect(bad.res.status).toBe(401);
		expect(bad.json.code).toBe('unauthenticated');
	});

	it('current-user works after login and fails after logout', async () => {
		const { cookie } = await login(app, 'student@example.test', 'student123');
		const me = await app.request('/api/me', { headers: { Cookie: cookie } });
		expect(me.status).toBe(200);
		const meJson = await me.json();
		expect(meJson.user.id).toBe('stu-1');
		expect(meJson.user.password_hash).toBeUndefined();

		const unauth = await app.request('/api/me');
		expect(unauth.status).toBe(401);

		await app.request('/api/logout', { method: 'POST', headers: { Cookie: cookie } });
		const after = await app.request('/api/me', { headers: { Cookie: cookie } });
		expect(after.status).toBe(401);
	});

	it('student can create a grievance', async () => {
		const { cookie } = await login(app, 'student@example.test', 'student123');
		const res = await app.request('/api/grievances', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: cookie },
			body: JSON.stringify({
				title: 'Broken cupboard hinge',
				category: 'Room',
				description: 'The cupboard hinge in B-204 is broken and the door will not close properly.'
			})
		});
		expect(res.status).toBe(201);
		const json = await res.json();
		expect(json.data.id).toMatch(/^GRV-\d{4}$/);
		expect(json.data.studentId).toBe('stu-1');
		expect(json.data.status).toBe('Open');
		expect(json.data.student.email).toBe('student@example.test');
	});

	it('student can retrieve a permitted grievance', async () => {
		const { cookie } = await login(app, 'student@example.test', 'student123');
		const res = await app.request('/api/grievances/GRV-0001', { headers: { Cookie: cookie } });
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.data.id).toBe('GRV-0001');
		expect(json.data.comments.length).toBeGreaterThan(0);
		expect(json.data.attachments[0].filename).toBe('leaking-tap.jpg');
	});

	it('student cannot access another student’s grievance', async () => {
		const { cookie } = await login(app, 'student@example.test', 'student123');
		const res = await app.request('/api/grievances/GRV-0003', { headers: { Cookie: cookie } });
		expect(res.status).toBe(403);
		const json = await res.json();
		expect(json.code).toBe('unauthorized');

		const list = await app.request('/api/grievances', { headers: { Cookie: cookie } });
		const listJson = await list.json();
		expect(listJson.data.every((g: { studentId: string }) => g.studentId === 'stu-1')).toBe(true);
		expect(listJson.data.some((g: { id: string }) => g.id === 'GRV-0003')).toBe(false);
	});

	it('warden can access management functionality', async () => {
		const { cookie } = await login(app, 'warden@example.test', 'warden123');
		const list = await app.request('/api/grievances', { headers: { Cookie: cookie } });
		expect(list.status).toBe(200);
		const listJson = await list.json();
		expect(listJson.data.length).toBeGreaterThanOrEqual(8);

		const one = await app.request('/api/grievances/GRV-0003', { headers: { Cookie: cookie } });
		expect(one.status).toBe(200);
	});

	it('comments work for permitted users', async () => {
		const { cookie } = await login(app, 'student@example.test', 'student123');
		const res = await app.request('/api/grievances/GRV-0001/comments', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: cookie },
			body: JSON.stringify({ body: 'Following up on the leak this morning.' })
		});
		expect(res.status).toBe(201);
		const json = await res.json();
		expect(json.data.body).toContain('Following up');
		expect(json.data.author.id).toBe('stu-1');
		expect(json.data.author.password_hash).toBeUndefined();

		const list = await app.request('/api/grievances/GRV-0001/comments', { headers: { Cookie: cookie } });
		const listed = await list.json();
		expect(listed.data.some((c: { id: string }) => c.id === json.data.id)).toBe(true);
	});

	it('status changes work for wardens and are forbidden for students', async () => {
		const student = await login(app, 'student@example.test', 'student123');
		const denied = await app.request('/api/grievances/GRV-0001', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', Cookie: student.cookie },
			body: JSON.stringify({ status: 'Resolved' })
		});
		expect(denied.status).toBe(403);

		const warden = await login(app, 'warden@example.test', 'warden123');
		const updated = await app.request('/api/grievances/GRV-0008', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', Cookie: warden.cookie },
			body: JSON.stringify({ status: 'In Progress' })
		});
		expect(updated.status).toBe(200);
		const json = await updated.json();
		expect(json.data.status).toBe('In Progress');
	});

	it('attachment metadata and storage work', async () => {
		const { cookie } = await login(app, 'student@example.test', 'student123');
		const created = await app.request('/api/grievances', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: cookie },
			body: JSON.stringify({
				title: 'Need a photo on file',
				category: 'Other',
				description: 'Filing this so I can attach a photo of the damaged locker door.'
			})
		});
		const grievance = await created.json();
		const id = grievance.data.id as string;

		const form = new FormData();
		form.append('file', new File([PNG], 'locker.png', { type: 'image/png' }));
		const uploaded = await app.request(`/api/grievances/${id}/attachments`, {
			method: 'POST',
			headers: { Cookie: cookie },
			body: form
		});
		expect(uploaded.status).toBe(201);
		const meta = await uploaded.json();
		expect(meta.data.filename).toBe('locker.png');
		expect(meta.data.contentType).toBe('image/png');
		expect(meta.data.sizeBytes).toBe(PNG.length);

		const fileRes = await app.request(`/api/attachments/${meta.data.id}`, { headers: { Cookie: cookie } });
		expect(fileRes.status).toBe(200);
		expect(fileRes.headers.get('content-type')).toBe('image/png');
		const bytes = Buffer.from(await fileRes.arrayBuffer());
		expect(bytes.equals(PNG)).toBe(true);

		const other = await login(app, 'priya@example.test', 'student123');
		const stolen = await app.request(`/api/attachments/${meta.data.id}`, {
			headers: { Cookie: other.cookie }
		});
		expect(stolen.status).toBe(403);
	});

	it('rejects oversized and disallowed attachments', async () => {
		const { cookie } = await login(app, 'student@example.test', 'student123');
		const huge = new Uint8Array(2 * 1024 * 1024 + 1);
		const over = new FormData();
		over.append('file', new File([huge], 'big.png', { type: 'image/png' }));
		const overRes = await app.request('/api/grievances/GRV-0008/attachments', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: over
		});
		expect(overRes.status).toBe(400);

		const invalid = new FormData();
		invalid.append('file', new File(['not-an-image'], 'notes.txt', { type: 'text/plain' }));
		const invalidRes = await app.request('/api/grievances/GRV-0008/attachments', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: invalid
		});
		expect(invalidRes.status).toBe(400);
	});

	it('lets a student edit their own open grievance but not a resolved one', async () => {
		const { cookie } = await login(app, 'student@example.test', 'student123');
		const edited = await app.request('/api/grievances/GRV-0008', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', Cookie: cookie },
			body: JSON.stringify({ title: 'Mess tables still dirty before dinner' })
		});
		expect(edited.status).toBe(200);
		const editedJson = await edited.json();
		expect(editedJson.data.title).toContain('still dirty');

		const other = await login(app, 'priya@example.test', 'student123');
		const forbidden = await app.request('/api/grievances/GRV-0008', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', Cookie: other.cookie },
			body: JSON.stringify({ title: 'Should not work at all here' })
		});
		expect(forbidden.status).toBe(403);

		const rohan = await login(app, 'rohan@example.test', 'student123');
		const resolved = await app.request('/api/grievances/GRV-0004', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', Cookie: rohan.cookie },
			body: JSON.stringify({ title: 'Trying to change a resolved ticket' })
		});
		expect(resolved.status).toBe(409);
		const resolvedJson = await resolved.json();
		expect(resolvedJson.code).toBe('conflict');
	});

	it('rejects unauthenticated grievance access', async () => {
		const res = await app.request('/api/grievances');
		expect(res.status).toBe(401);
	});

	it('returns 404 for unknown grievance ids without leaking internals', async () => {
		const { cookie } = await login(app, 'warden@example.test', 'warden123');
		const res = await app.request('/api/grievances/GRV-9999', { headers: { Cookie: cookie } });
		expect(res.status).toBe(404);
		const json = await res.json();
		expect(json.code).toBe('not_found');
		expect(JSON.stringify(json)).not.toMatch(/sqlite|stack|ENOENT/i);
	});

	it('enforces password complexity rules on password change and resets', async () => {
		const { cookie } = await login(app, 'student@example.test', 'student123');

		// Too short (< 8)
		const tooShort = await app.request('/api/change-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: cookie },
			body: JSON.stringify({ currentPassword: 'student123', newPassword: 'Ab1!' })
		});
		expect(tooShort.status).toBe(400);
		const tooShortJson = await tooShort.json();
		expect(tooShortJson.error).toContain('at least 8 characters');

		// No digit
		const noDigit = await app.request('/api/change-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: cookie },
			body: JSON.stringify({ currentPassword: 'student123', newPassword: 'Password!@#' })
		});
		expect(noDigit.status).toBe(400);
		const noDigitJson = await noDigit.json();
		expect(noDigitJson.error).toContain('numeric digit');

		// No special char
		const noSpecial = await app.request('/api/change-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: cookie },
			body: JSON.stringify({ currentPassword: 'student123', newPassword: 'Password123' })
		});
		expect(noSpecial.status).toBe(400);
		const noSpecialJson = await noSpecial.json();
		expect(noSpecialJson.error).toContain('special character');

		// Valid password
		const valid = await app.request('/api/change-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: cookie },
			body: JSON.stringify({ currentPassword: 'student123', newPassword: 'NewSecurePass123!' })
		});
		expect(valid.status).toBe(200);

		// Old password fails, new password succeeds
		const loginOld = await login(app, 'student@example.test', 'student123');
		expect(loginOld.res.status).toBe(401);

		const loginNew = await login(app, 'student@example.test', 'NewSecurePass123!');
		expect(loginNew.res.status).toBe(200);
	});

	it('warden can generate reset token and user can reset password', async () => {
		const student = await login(app, 'priya@example.test', 'student123');

		// Student cannot generate reset tokens
		const studentAttempt = await app.request('/api/admin/reset-token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: student.cookie },
			body: JSON.stringify({ email: 'priya@example.test' })
		});
		expect(studentAttempt.status).toBe(403);

		// Warden generates reset token for student
		const warden = await login(app, 'warden@example.test', 'warden123');
		const tokenRes = await app.request('/api/admin/reset-token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: warden.cookie },
			body: JSON.stringify({ email: 'priya@example.test' })
		});
		expect(tokenRes.status).toBe(201);
		const tokenData = await tokenRes.json();
		expect(tokenData.token).toBeDefined();
		expect(tokenData.targetUser.email).toBe('priya@example.test');

		// Invalid reset token is rejected
		const badToken = await app.request('/api/reset-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: 'fake-token-123', newPassword: 'PriyaNewPass456#' })
		});
		expect(badToken.status).toBe(400);

		// Reset password with valid token
		const resetSuccess = await app.request('/api/reset-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: tokenData.token, newPassword: 'PriyaNewPass456#' })
		});
		expect(resetSuccess.status).toBe(200);

		// Token cannot be reused
		const reuseToken = await app.request('/api/reset-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: tokenData.token, newPassword: 'AnotherPass789!' })
		});
		expect(reuseToken.status).toBe(400);

		// Student previous session is revoked
		const oldSessionCheck = await app.request('/api/me', { headers: { Cookie: student.cookie } });
		expect(oldSessionCheck.status).toBe(401);

		// Student logs in with newly reset password
		const priyaNewLogin = await login(app, 'priya@example.test', 'PriyaNewPass456#');
		expect(priyaNewLogin.res.status).toBe(200);
	});

	it('warden can directly reset user password', async () => {
		const rohan = await login(app, 'rohan@example.test', 'student123');
		const warden = await login(app, 'warden@example.test', 'warden123');

		// Student cannot direct-reset
		const studentDirect = await app.request('/api/admin/reset-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: rohan.cookie },
			body: JSON.stringify({ email: 'rohan@example.test', newPassword: 'RohanAdminReset789!' })
		});
		expect(studentDirect.status).toBe(403);

		// Warden direct resets
		const wardenDirect = await app.request('/api/admin/reset-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: warden.cookie },
			body: JSON.stringify({ email: 'rohan@example.test', newPassword: 'RohanAdminReset789!' })
		});
		expect(wardenDirect.status).toBe(200);

		// Old session revoked
		const checkOld = await app.request('/api/me', { headers: { Cookie: rohan.cookie } });
		expect(checkOld.status).toBe(401);

		// Log in with new password
		const rohanNewLogin = await login(app, 'rohan@example.test', 'RohanAdminReset789!');
		expect(rohanNewLogin.res.status).toBe(200);
	});

	it('records audit logs and allows wardens to inspect them', async () => {
		const warden = await login(app, 'warden@example.test', 'warden123');
		const student = await login(app, 'student@example.test', 'student123');

		// Student cannot access audit logs
		const studentAttempt = await app.request('/api/admin/audit-logs', {
			headers: { Cookie: student.cookie }
		});
		expect(studentAttempt.status).toBe(403);

		// Warden can query audit logs
		const auditRes = await app.request('/api/admin/audit-logs', {
			headers: { Cookie: warden.cookie }
		});
		expect(auditRes.status).toBe(200);
		const auditJson = await auditRes.json();
		expect(Array.isArray(auditJson.data)).toBe(true);
		expect(auditJson.data.length).toBeGreaterThan(0);

		// Verify audit logs contain actions like auth.login
		const loginLog = auditJson.data.find((log: { action: string }) => log.action === 'auth.login');
		expect(loginLog).toBeDefined();
		expect(loginLog.ipAddress).toBeDefined();
	});

	it('creates and manages notifications for students upon warden actions', async () => {
		const student = await login(app, 'student@example.test', 'student123');
		const warden = await login(app, 'warden@example.test', 'warden123');

		// Create a grievance as student
		const createRes = await app.request('/api/grievances', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: student.cookie },
			body: JSON.stringify({
				title: 'Room heater issue',
				category: 'Maintenance',
				description: 'Room heater is not turning on in the cold winter nights.'
			})
		});
		expect(createRes.status).toBe(201);
		const createdGrievance = await createRes.json();
		const gId = createdGrievance.data.id;

		// Warden updates status to in_progress
		const statusRes = await app.request(`/api/grievances/${gId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', Cookie: warden.cookie },
			body: JSON.stringify({ status: 'In Progress' })
		});
		expect(statusRes.status).toBe(200);

		// Student checks notifications
		const notifRes = await app.request('/api/notifications', {
			headers: { Cookie: student.cookie }
		});
		expect(notifRes.status).toBe(200);
		const notifJson = await notifRes.json();
		expect(notifJson.unreadCount).toBeGreaterThanOrEqual(1);

		const targetNotif = notifJson.data.find((n: { grievanceId: string }) => n.grievanceId === gId);
		expect(targetNotif).toBeDefined();
		expect(targetNotif.isRead).toBe(false);
		expect(targetNotif.title).toContain('Status');

		// Mark notification read
		const markReadRes = await app.request(`/api/notifications/${targetNotif.id}/read`, {
			method: 'PATCH',
			headers: { Cookie: student.cookie }
		});
		expect(markReadRes.status).toBe(200);

		// Mark all read
		const markAllRes = await app.request('/api/notifications/read-all', {
			method: 'POST',
			headers: { Cookie: student.cookie }
		});
		expect(markAllRes.status).toBe(200);
	});

	it('supports student withdrawal and warden archiving without permanent data loss', async () => {
		const student = await login(app, 'student@example.test', 'student123');
		const warden = await login(app, 'warden@example.test', 'warden123');

		// Student files a grievance to withdraw
		const createRes = await app.request('/api/grievances', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: student.cookie },
			body: JSON.stringify({
				title: 'Duplicate fan issue report',
				category: 'Electricity',
				description: 'Accidentally filed duplicate report for ceiling fan.'
			})
		});
		const gId = (await createRes.json()).data.id;

		// Student withdraws it
		const withdrawRes = await app.request(`/api/grievances/${gId}/withdraw`, {
			method: 'POST',
			headers: { Cookie: student.cookie }
		});
		expect(withdrawRes.status).toBe(200);

		// Default student list does NOT show the withdrawn grievance
		const listRes = await app.request('/api/grievances', {
			headers: { Cookie: student.cookie }
		});
		const listJson = await listRes.json();
		expect(listJson.data.some((g: { id: string }) => g.id === gId)).toBe(false);

		// Withdrawn grievance cannot be edited
		const editAttempt = await app.request(`/api/grievances/${gId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', Cookie: student.cookie },
			body: JSON.stringify({ title: 'Trying to update withdrawn' })
		});
		expect(editAttempt.status).toBe(409);

		// Warden resolves another grievance then archives it
		const createForArchive = await app.request('/api/grievances', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: student.cookie },
			body: JSON.stringify({
				title: 'Broken chair replacement',
				category: 'Room',
				description: 'Study chair leg is broken, need a replacement.'
			})
		});
		const archId = (await createForArchive.json()).data.id;

		// Cannot archive while open
		const badArchive = await app.request(`/api/grievances/${archId}/archive`, {
			method: 'POST',
			headers: { Cookie: warden.cookie }
		});
		expect(badArchive.status).toBe(409);

		// Warden resolves it
		await app.request(`/api/grievances/${archId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', Cookie: warden.cookie },
			body: JSON.stringify({ status: 'Resolved' })
		});

		// Warden archives it
		const archiveRes = await app.request(`/api/grievances/${archId}/archive`, {
			method: 'POST',
			headers: { Cookie: warden.cookie }
		});
		expect(archiveRes.status).toBe(200);

		// Archived grievance not in default list
		const wardenList = await app.request('/api/grievances', {
			headers: { Cookie: warden.cookie }
		});
		expect((await wardenList.json()).data.some((g: { id: string }) => g.id === archId)).toBe(false);

		// Archived grievance IS present when query include_archived=true
		const archivedList = await app.request('/api/grievances?include_archived=true', {
			headers: { Cookie: warden.cookie }
		});
		expect((await archivedList.json()).data.some((g: { id: string }) => g.id === archId)).toBe(true);
	});
});


