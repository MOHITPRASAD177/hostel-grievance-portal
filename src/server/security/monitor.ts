/**
 * GrievanceGuard — Threat Monitor & SecOps Telemetry Engine
 *
 * Real-time active defense:
 *  - Canary / Honeytoken Trap trigger & instant IP isolation
 *  - IDOR probing detection & mitigation
 *  - Authorization failure storm tracking
 *  - Automated flood throttling
 *  - Telemetry aggregator for SecOps dashboard
 */

import type { Database } from 'better-sqlite3';
import { recordAuditLog, verifyAuditLogIntegrity } from '../db/queries.ts';
import { toPublicAuditLog } from '../db/map.ts';
import type { AuditLogRow, SecOpsTelemetry } from '../types/index.ts';

export type ThreatLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SecurityEvent {
	type: string;
	ipAddress: string;
	userId: string | null;
	detail: string;
	timestamp: number;
	level: ThreatLevel;
}

interface IpState {
	authzFailures: number[];
	resourcesAccessed: Set<string>;
	requestTimestamps: number[];
	blockedUntil: number;
}

// In-memory state — resets on server restart
const ipStates = new Map<string, IpState>();

// Config thresholds
const WINDOW_MS = 60_000; // 1-minute rolling window
const AUTHZ_FAILURE_THRESHOLD = 8; // Block after 8 forbidden errors / minute
const IDOR_PROBE_THRESHOLD = 15; // Block after accessing 15 distinct resource IDs / minute
const FLOOD_THRESHOLD = 200; // Block after 200 requests / minute
const BLOCK_DURATION_MS = 15 * 60_000; // Block for 15 minutes
const CANARY_BLOCK_DURATION_MS = 60 * 60_000; // Canary trap triggers 60-minute isolation

function getOrCreateState(ip: string): IpState {
	let state = ipStates.get(ip);
	if (!state) {
		state = {
			authzFailures: [],
			resourcesAccessed: new Set(),
			requestTimestamps: [],
			blockedUntil: 0
		};
		ipStates.set(ip, state);
	}
	return state;
}

function pruneOldEntries(timestamps: number[], now: number): number[] {
	return timestamps.filter((t) => now - t < WINDOW_MS);
}

/**
 * Check if an IP is currently blocked.
 * Returns null if clear, or a message string if blocked.
 */
export function checkIpBlocked(ip: string): string | null {
	const state = ipStates.get(ip);
	if (!state) return null;
	if (state.blockedUntil > Date.now()) {
		const remainingMs = state.blockedUntil - Date.now();
		const remainingMin = Math.ceil(remainingMs / 60_000);
		return `Your IP has been temporarily blocked due to suspicious activity. Try again in ${remainingMin} minute(s).`;
	}
	return null;
}

/**
 * Record a new request from an IP for flood detection.
 */
export function trackRequest(ip: string): void {
	const now = Date.now();
	const state = getOrCreateState(ip);
	state.requestTimestamps = pruneOldEntries(state.requestTimestamps, now);
	state.requestTimestamps.push(now);

	if (state.requestTimestamps.length > FLOOD_THRESHOLD) {
		state.blockedUntil = now + BLOCK_DURATION_MS;
	}
}

/**
 * Trigger Canary / Honeytoken Trap when a forbidden fake resource is requested.
 * Automatically initiates immediate 60-minute IP ban and logs critical security alert.
 */
export function triggerCanaryTrap(
	ip: string,
	userId: string | null,
	canaryId: string,
	db: Database
): void {
	const now = Date.now();
	const state = getOrCreateState(ip);
	state.blockedUntil = now + CANARY_BLOCK_DURATION_MS;

	logSecurityEvent(db, {
		type: 'honeytoken_trap_triggered',
		ipAddress: ip,
		userId,
		detail: `Adversary accessed deceptive canary resource ${canaryId}. Instant 60-minute IP isolation activated.`,
		timestamp: now,
		level: 'critical'
	});
}

/**
 * Record an authorization failure (403 / 401) from an IP.
 * Triggers a block after threshold is exceeded.
 */
export function trackAuthzFailure(
	ip: string,
	userId: string | null,
	resourceId: string | null,
	db: Database
): void {
	const now = Date.now();
	const state = getOrCreateState(ip);
	state.authzFailures = pruneOldEntries(state.authzFailures, now);
	state.authzFailures.push(now);

	// IDOR probe: track distinct resource IDs accessed
	if (resourceId) {
		state.resourcesAccessed.add(resourceId);
		if (state.resourcesAccessed.size > IDOR_PROBE_THRESHOLD) {
			const wasBlocked = state.blockedUntil > now;
			state.blockedUntil = now + BLOCK_DURATION_MS;
			if (!wasBlocked) {
				logSecurityEvent(db, {
					type: 'idor_probe_detected',
					ipAddress: ip,
					userId,
					detail: `IP scanned ${state.resourcesAccessed.size} distinct resource IDs in 1 minute`,
					timestamp: now,
					level: 'high'
				});
			}
			state.resourcesAccessed.clear();
		}
	}

	if (state.authzFailures.length >= AUTHZ_FAILURE_THRESHOLD) {
		const wasBlocked = state.blockedUntil > now;
		state.blockedUntil = now + BLOCK_DURATION_MS;
		if (!wasBlocked) {
			logSecurityEvent(db, {
				type: 'authz_failure_storm',
				ipAddress: ip,
				userId,
				detail: `${state.authzFailures.length} authorization failures in 1 minute`,
				timestamp: now,
				level: 'high'
			});
		}
		state.authzFailures = [];
	}
}

/**
 * Track a successful resource access.
 */
export function trackResourceAccess(ip: string, resourceId: string): void {
	const now = Date.now();
	const state = getOrCreateState(ip);
	if (state.requestTimestamps.length > 0) {
		const oldest = Math.min(...state.requestTimestamps);
		if (now - oldest > WINDOW_MS) {
			state.resourcesAccessed.clear();
		}
	}
	state.resourcesAccessed.add(resourceId);
}

/**
 * Persist a security event to the audit log table.
 */
function logSecurityEvent(db: Database, event: SecurityEvent): void {
	console.warn(
		`[GrievanceGuard 🛡️] SECURITY EVENT [${event.level.toUpperCase()}]: ${event.type} — ${event.detail} (IP: ${event.ipAddress})`
	);

	try {
		recordAuditLog(db, {
			userId: event.userId ?? null,
			action: `security.${event.type}`,
			targetType: 'ip',
			targetId: event.ipAddress,
			details: { detail: event.detail, level: event.level },
			ipAddress: event.ipAddress,
			userAgent: 'system'
		});
	} catch {
		// Never crash the main request handler due to audit log failures
	}
}

/**
 * Get comprehensive SecOps telemetry for warden dashboard.
 */
export function getSecOpsTelemetry(db: Database): SecOpsTelemetry {
	const now = Date.now();
	const bannedIpsList: Array<{ ip: string; blockedUntil: string | null; recentFailures: number }> = [];

	for (const [ip, state] of ipStates.entries()) {
		if (state.blockedUntil > now) {
			bannedIpsList.push({
				ip,
				blockedUntil: new Date(state.blockedUntil).toISOString(),
				recentFailures: state.authzFailures.length
			});
		}
	}

	const todayStart = new Date();
	todayStart.setHours(0, 0, 0, 0);
	const todayIso = todayStart.toISOString();

	const secEventsCountRow = db
		.prepare(`SELECT COUNT(*) as count FROM audit_logs WHERE action LIKE 'security.%' AND created_at >= ?`)
		.get(todayIso) as { count: number };

	const canaryCountRow = db
		.prepare(`SELECT COUNT(*) as count FROM audit_logs WHERE action = 'security.honeytoken_trap_triggered'`)
		.get() as { count: number };

	const recentAlertRows = db
		.prepare(`SELECT * FROM audit_logs WHERE action LIKE 'security.%' ORDER BY created_at DESC LIMIT 10`)
		.all() as AuditLogRow[];

	const integrity = verifyAuditLogIntegrity(db);

	let threatLevel: 'DEFCON_5_NORMAL' | 'DEFCON_3_ELEVATED' | 'DEFCON_1_CRITICAL' = 'DEFCON_5_NORMAL';
	if (canaryCountRow.count > 0 || bannedIpsList.length > 3) {
		threatLevel = 'DEFCON_1_CRITICAL';
	} else if (bannedIpsList.length > 0 || secEventsCountRow.count > 5) {
		threatLevel = 'DEFCON_3_ELEVATED';
	}

	return {
		threatLevel,
		activeBannedIpsCount: bannedIpsList.length,
		bannedIps: bannedIpsList,
		totalSecurityEventsToday: secEventsCountRow.count,
		canaryTrapHits: canaryCountRow.count,
		auditChainIntegrity: {
			verified: integrity.verified,
			totalRecords: integrity.totalRecords,
			latestHash: integrity.latestHash
		},
		recentSecurityAlerts: recentAlertRows.map(toPublicAuditLog)
	};
}
