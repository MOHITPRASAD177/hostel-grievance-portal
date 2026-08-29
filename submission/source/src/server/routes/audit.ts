import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { requireUser } from '../auth/session.ts';
import { listAuditLogs, verifyAuditLogIntegrity } from '../db/queries.ts';
import { toPublicAuditLog } from '../db/map.ts';
import { HttpError } from '../http/errors.ts';
import { getSecOpsTelemetry } from '../security/monitor.ts';

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

/**
 * Cryptographic Hash-Chain Integrity Verification Endpoint
 * Validates SHA-256 chain across all historical audit records.
 */
auditRoutes.get('/verify', (c) => {
	const db = c.get('db');
	const user = requireUser(c, db);
	if (user.role !== 'warden') {
		throw new HttpError(403, 'unauthorized', 'Only wardens can verify audit logs.');
	}

	const integrity = verifyAuditLogIntegrity(db);
	return c.json({
		data: {
			status: integrity.verified ? 'VALID_AND_UNTOUCHED' : 'CHAIN_TAMPERED',
			verified: integrity.verified,
			totalRecords: integrity.totalRecords,
			latestHash: integrity.latestHash,
			brokenAtId: integrity.brokenAtId ?? null,
			timestamp: new Date().toISOString()
		}
	});
});

/**
 * Live SecOps Threat Telemetry Dashboard API
 * Returns DEFCON status, active IP blocks, and live alert telemetry.
 */
auditRoutes.get('/telemetry', (c) => {
	const db = c.get('db');
	const user = requireUser(c, db);
	if (user.role !== 'warden') {
		throw new HttpError(403, 'unauthorized', 'Only wardens can access SecOps telemetry.');
	}

	const telemetry = getSecOpsTelemetry(db);
	return c.json({ data: telemetry });
});
