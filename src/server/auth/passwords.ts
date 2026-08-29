import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../http/errors.ts';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
	const salt = randomBytes(16).toString('hex');
	const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
	return `scrypt:${salt}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const parts = stored.split(':');
	if (parts.length === 3 && parts[0] === 'scrypt') {
		const [, salt, hash] = parts;
		if (!salt || !hash) return false;
		const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
		const expected = Buffer.from(hash, 'hex');
		if (actual.length !== expected.length) return false;
		return timingSafeEqual(actual, expected);
	}
	if (parts.length === 2 && parts[0] === 'sha256') {
		const [, hash] = parts;
		if (!hash) return false;
		const actual = createHash('sha256').update(password).digest();
		const expected = Buffer.from(hash, 'hex');
		if (actual.length !== expected.length) return false;
		return timingSafeEqual(actual, expected);
	}
	return false;
}

export function validatePasswordComplexity(password: string): void {
	if (typeof password !== 'string') {
		throw new HttpError(400, 'bad_request', 'Password must be a string.');
	}
	if (password.length < 8) {
		throw new HttpError(400, 'bad_request', 'Password must be at least 8 characters long.');
	}
	if (password.length > 128) {
		throw new HttpError(400, 'bad_request', 'Password must be 128 characters or fewer.');
	}
	if (!/[0-9]/.test(password)) {
		throw new HttpError(400, 'bad_request', 'Password must contain at least one numeric digit (0-9).');
	}
	if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`^]/.test(password)) {
		throw new HttpError(
			400,
			'bad_request',
			'Password must contain at least one special character (!@#$%^&* etc.).'
		);
	}
}

