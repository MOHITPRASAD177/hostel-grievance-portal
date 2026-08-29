/**
 * GrievanceGuard — Security Gateway Middleware
 *
 * This is the outermost layer every request passes through before reaching
 * any route handler. It implements the full security pipeline:
 *
 *   CLIENT → [IP Blocklist] → [Rate Limit] → [Request Size] →
 *   [Suspicious Patterns] → [Security Headers] → [CORS] → Route Handler
 *
 * The gateway is stateless about authentication — session checking is done
 * downstream in individual route handlers via requireUser().
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env.ts';
import { HttpError } from '../http/errors.ts';
import { checkIpBlocked, trackRequest } from './monitor.ts';

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB hard cap on all requests

// Suspicious path segments that indicate scanning/attack tools
const SUSPICIOUS_PATTERNS = [
	/\.\.\//,             // Path traversal
	/<script/i,           // XSS probe
	/union\s+select/i,    // SQL injection
	/exec\s*\(/i,         // Code injection
	/\x00/,               // Null byte injection
	/etc\/passwd/i,       // Linux file probe
	/cmd\.exe/i,          // Windows shell probe
	/base64_decode/i,     // PHP injection pattern
	/\%00/,               // URL-encoded null byte
];

// ─────────────────────────────────────────────
// IP extraction helper
// ─────────────────────────────────────────────

export function extractIp(c: Context): string {
	return (
		c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
		c.req.header('x-real-ip') ??
		'127.0.0.1'
	);
}

// ─────────────────────────────────────────────
// Security Headers middleware
// ─────────────────────────────────────────────

export const securityHeadersMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
	// Attach DB and uploadsDir early so all downstream middleware can access them
	await next();

	// Headers are set after the response is generated (avoids overwriting route headers)
	c.header('X-Content-Type-Options', 'nosniff');
	c.header('X-Frame-Options', 'DENY');
	c.header('X-XSS-Protection', '0');
	c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
	c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
	c.header('X-Powered-By', 'GrievanceGuard'); // Replace default server fingerprint
};

// ─────────────────────────────────────────────
// Gateway middleware (main pipeline)
// ─────────────────────────────────────────────

export const gatewayMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
	const ip = extractIp(c);
	const method = c.req.method;
	const path = c.req.path;
	const url = c.req.url;

	// ── Step 1: IP Blocklist ─────────────────────────────
	const blockReason = checkIpBlocked(ip);
	if (blockReason) {
		throw new HttpError(429, 'too_many_requests', blockReason);
	}

	// ── Step 2: Flood tracking ───────────────────────────
	trackRequest(ip);

	// ── Step 3: Request body size cap ────────────────────
	const contentLength = parseInt(c.req.header('content-length') ?? '0', 10);
	if (contentLength > MAX_BODY_BYTES) {
		throw new HttpError(
			413,
			'payload_too_large',
			`Request body must not exceed ${MAX_BODY_BYTES / 1024 / 1024} MB.`
		);
	}

	// ── Step 4: Suspicious pattern screening ─────────────
	const fullPath = decodeURIComponent(url);
	for (const pattern of SUSPICIOUS_PATTERNS) {
		if (pattern.test(fullPath)) {
			console.warn(
				`[GrievanceGuard 🛡️] Suspicious request blocked — IP: ${ip}, Method: ${method}, Path: ${path}, Pattern: ${pattern}`
			);
			// Return generic 400 — don't reveal we detected a pattern
			throw new HttpError(400, 'bad_request', 'Invalid request.');
		}
	}

	await next();
};
