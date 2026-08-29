/**
 * GrievanceGuard — Threat Monitor
 *
 * Detects and responds to suspicious access patterns in real-time:
 *  - IDOR probing (rapid sequential grievance ID scanning)
 *  - Authorization failure storms (repeated 403/401 from same IP)
 *  - Automated scraping / flood attacks
 *
 * All security events are stored in-memory and written to the audit log.
 */

import type { Database } from 'better-sqlite3';
import { recordAuditLog } from '../db/queries.ts';

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
	// Authorization failures (403 / 401)
	authzFailures: number[];
	// Distinct resource IDs accessed (IDOR probe detection)
	resourcesAccessed: Set<string>;
	// Total requests
	requestTimestamps: number[];
	// Whether this IP is currently blocked
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
		// Prune old resource entries every 1 minute
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
 * Track a successful resource access (for IDOR pattern analysis).
 * Wardens accessing their own resources are excluded from IDOR tracking.
 */
export function trackResourceAccess(ip: string, resourceId: string): void {
	const now = Date.now();
	const state = getOrCreateState(ip);

	// Reset resource set if the window has passed
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
 * Get current threat stats for an IP (for admin inspection).
 */
export function getIpStats(ip: string) {
	const state = ipStates.get(ip);
	if (!state) return null;
	const now = Date.now();
	return {
		ip,
		isBlocked: state.blockedUntil > now,
		blockedUntil: state.blockedUntil > now ? new Date(state.blockedUntil).toISOString() : null,
		recentRequests: pruneOldEntries(state.requestTimestamps, now).length,
		recentAuthzFailures: pruneOldEntries(state.authzFailures, now).length,
		distinctResourcesAccessed: state.resourcesAccessed.size
	};
}
