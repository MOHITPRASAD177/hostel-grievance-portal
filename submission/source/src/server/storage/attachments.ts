import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '../config.ts';
import { HttpError } from '../http/errors.ts';

const MIME_EXTENSION: Record<string, string> = {
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/gif': '.gif',
	'image/webp': '.webp'
};

export function ensureUploadsDir(dir: string): void {
	mkdirSync(dir, { recursive: true });
}

export function resetUploadsDir(dir: string): void {
	if (existsSync(dir)) {
		rmSync(dir, { recursive: true, force: true });
	}
	mkdirSync(dir, { recursive: true });
}

export function originalBasename(filename: string): string {
	const base = filename.replace(/\\/g, '/').split('/').pop() ?? 'upload';
	const cleaned = base.replace(/[\0\r\n]/g, '').trim();
	return cleaned.length > 0 ? cleaned.slice(0, 255) : 'upload';
}

export function extensionForMime(mime: string): string {
	return MIME_EXTENSION[mime] ?? '.bin';
}

export function newStoredName(mime: string): string {
	return `${randomBytes(16).toString('hex')}${extensionForMime(mime)}`;
}

export function detectImageMimeType(bytes: Buffer): string | null {
	if (bytes.length < 4) return null;
	// PNG: 89 50 4E 47
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
		return 'image/png';
	}
	// JPEG: FF D8 FF
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg';
	}
	// GIF: GIF87a or GIF89a
	if (
		bytes.length >= 6 &&
		bytes[0] === 0x47 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x38 &&
		(bytes[4] === 0x37 || bytes[4] === 0x39) &&
		bytes[5] === 0x61
	) {
		return 'image/gif';
	}
	// WebP: RIFF....WEBP
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return 'image/webp';
	}
	return null;
}

/**
 * Strip EXIF, GPS coordinates, camera serials, and ancillary metadata
 * from JPEG and PNG files to protect student privacy and room geolocation.
 */
export function stripImageMetadata(bytes: Buffer, mime: string): Buffer {
	try {
		if (mime === 'image/jpeg' && bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
			const chunks: Buffer[] = [bytes.subarray(0, 2)]; // Start with SOI (FF D8)
			let pos = 2;
			while (pos < bytes.length) {
				if (bytes[pos] !== 0xff) break;
				const marker = bytes[pos + 1];
				// End of Image (EOI) or Start of Scan (SOS - compressed image data follows)
				if (marker === 0xd9 || marker === 0xda) {
					chunks.push(bytes.subarray(pos));
					break;
				}
				if (pos + 4 > bytes.length) break;
				const segLen = bytes.readUInt16BE(pos + 2);
				// Skip APP1 (0xE1 = EXIF/GPS), APP2 (0xE2), COM (0xFE = Comment)
				if (marker === 0xe1 || marker === 0xfe) {
					pos += 2 + segLen;
					continue;
				}
				chunks.push(bytes.subarray(pos, pos + 2 + segLen));
				pos += 2 + segLen;
			}
			const result = Buffer.concat(chunks);
			if (result.length > 2 && result[0] === 0xff && result[1] === 0xd8) {
				return result;
			}
		}

		if (mime === 'image/png' && bytes.length > 8) {
			const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
			if (bytes.subarray(0, 8).equals(pngSig)) {
				const chunks: Buffer[] = [bytes.subarray(0, 8)];
				let pos = 8;
				while (pos + 8 <= bytes.length) {
					const chunkLen = bytes.readUInt32BE(pos);
					const chunkType = bytes.subarray(pos + 4, pos + 8).toString('ascii');
					const totalChunkLen = 12 + chunkLen;
					if (pos + totalChunkLen > bytes.length) break;

					// Strip metadata chunks: eXIf, tEXt, zTXt, iTXt
					if (['eXIf', 'tEXt', 'zTXt', 'iTXt'].includes(chunkType)) {
						pos += totalChunkLen;
						continue;
					}

					chunks.push(bytes.subarray(pos, pos + totalChunkLen));
					pos += totalChunkLen;
					if (chunkType === 'IEND') break;
				}
				const result = Buffer.concat(chunks);
				if (result.length > 8) return result;
			}
		}
	} catch {
		// Fallback to original bytes if stripping fails for any reason
	}
	return bytes;
}

export function assertPermittedAttachment(mime: string, bytes: Buffer): void {
	if (!ALLOWED_ATTACHMENT_TYPES.has(mime)) {
		throw new HttpError(400, 'bad_request', 'Attachments must be JPEG, PNG, GIF, or WebP images.');
	}
	if (bytes.byteLength <= 0) {
		throw new HttpError(400, 'bad_request', 'Attachment file is empty.');
	}
	if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
		throw new HttpError(400, 'bad_request', 'Attachment must be 2 MB or smaller.');
	}
	const detectedMime = detectImageMimeType(bytes);
	if (!detectedMime || detectedMime !== mime) {
		throw new HttpError(400, 'bad_request', 'Attachment content does not match permitted image format.');
	}
}

export async function bufferFromUpload(file: File): Promise<Buffer> {
	const raw = Buffer.from(await file.arrayBuffer());
	assertPermittedAttachment(file.type, raw);
	const sanitized = stripImageMetadata(raw, file.type);
	return Buffer.from(sanitized);
}

export function writeStoredFile(uploadsDir: string, storedName: string, bytes: Buffer): void {
	if (storedName.includes('/') || storedName.includes('\\') || storedName.includes('..')) {
		throw new HttpError(400, 'bad_request', 'Invalid attachment filename.');
	}
	ensureUploadsDir(uploadsDir);
	const root = resolve(uploadsDir);
	const full = resolve(join(uploadsDir, storedName));
	if (full !== root && !full.startsWith(root + sep)) {
		throw new HttpError(400, 'bad_request', 'Invalid attachment path.');
	}
	writeFileSync(full, bytes);
}

export function readStoredFile(uploadsDir: string, storedName: string): Buffer {
	if (storedName.includes('/') || storedName.includes('\\') || storedName.includes('..')) {
		throw new HttpError(404, 'not_found', 'Attachment file was not found.');
	}
	const root = resolve(uploadsDir);
	const full = resolve(join(uploadsDir, storedName));
	if (full !== root && !full.startsWith(root + sep)) {
		throw new HttpError(404, 'not_found', 'Attachment file was not found.');
	}
	if (!existsSync(full)) {
		throw new HttpError(404, 'not_found', 'Attachment file was not found.');
	}
	return readFileSync(full);
}

export function listStoredNames(uploadsDir: string): string[] {
	if (!existsSync(uploadsDir)) return [];
	return readdirSync(uploadsDir).filter((name) => name !== '.gitkeep');
}
