/**
 * GrievanceGuard — Central Policy Engine
 *
 * Every grievance operation is evaluated through this single policy engine.
 * No route file contains inline authorization logic — all decisions route here.
 *
 * Policy results include:
 *  - allowed: boolean
 *  - reason: human-readable denial reason (or null if allowed)
 *  - auditAction: the action string to write to the audit log
 */

import type { GrievanceRow, SessionUser } from '../types/index.ts';
import { HttpError } from '../http/errors.ts';

export interface PolicyResult {
	allowed: boolean;
	reason: string | null;
	statusCode: 403 | 409 | 200;
}

const ALLOWED: PolicyResult = { allowed: true, reason: null, statusCode: 200 };

function deny(reason: string, statusCode: 403 | 409 = 403): PolicyResult {
	return { allowed: false, reason, statusCode };
}

/**
 * Throw an HttpError if the policy denies the action.
 * Used in route handlers: `GrievanceGuard.enforce(policy.canViewGrievance(user, row))`
 */
export function enforce(result: PolicyResult): void {
	if (!result.allowed) {
		throw new HttpError(
			result.statusCode,
			result.statusCode === 409 ? 'conflict' : 'unauthorized',
			result.reason!
		);
	}
}

// ─────────────────────────────────────────────
// Ownership helpers
// ─────────────────────────────────────────────

function isOwner(user: SessionUser, grievance: GrievanceRow): boolean {
	return grievance.student_id === user.id;
}

function isWarden(user: SessionUser): boolean {
	return user.role === 'warden';
}

function isStudent(user: SessionUser): boolean {
	return user.role === 'student';
}

function isWithdrawn(grievance: GrievanceRow): boolean {
	return grievance.deleted_at !== null && grievance.deleted_at !== undefined;
}

function isArchived(grievance: GrievanceRow): boolean {
	return grievance.archived_at !== null && grievance.archived_at !== undefined;
}

function isResolved(grievance: GrievanceRow): boolean {
	return grievance.status === 'resolved';
}

// ─────────────────────────────────────────────
// GrievanceGuard Policy Engine
// ─────────────────────────────────────────────

export const GrievanceGuard = {
	/**
	 * VIEW a grievance detail page.
	 * Students may only view their own; wardens may view any non-canary.
	 * Canary records are Honeytoken traps — access triggers instant security isolation.
	 */
	canView(user: SessionUser, grievance: GrievanceRow): PolicyResult {
		if (grievance.is_canary === 1) {
			return deny('Honeytoken trap triggered.', 403);
		}
		if (isWarden(user)) return ALLOWED;
		if (isStudent(user) && isOwner(user, grievance)) return ALLOWED;
		return deny('You are not authorized to view this grievance.');
	},

	/**
	 * EDIT the content fields of a grievance (title, description, category).
	 * Only the owning student may edit, and only while it's open and not withdrawn.
	 */
	canEditContent(user: SessionUser, grievance: GrievanceRow): PolicyResult {
		if (isWarden(user)) return deny('Wardens cannot edit grievance content.');
		if (!isOwner(user, grievance))
			return deny('Only the student owner can edit this grievance.');
		if (isResolved(grievance))
			return deny('Resolved grievances cannot be edited.', 409);
		if (isWithdrawn(grievance))
			return deny('Withdrawn grievances cannot be edited.', 409);
		return ALLOWED;
	},

	/**
	 * CHANGE the status of a grievance (open → in_progress → resolved).
	 * Only wardens may change status.
	 */
	canChangeStatus(user: SessionUser, _grievance: GrievanceRow): PolicyResult {
		if (isWarden(user)) return ALLOWED;
		return deny('Students cannot change grievance status.');
	},

	/**
	 * UPLOAD an attachment to a grievance.
	 * Only the owning student may upload, while the grievance is open.
	 */
	canUploadAttachment(user: SessionUser, grievance: GrievanceRow): PolicyResult {
		if (isWarden(user)) return deny('Only the student owner can add attachments.');
		if (!isOwner(user, grievance)) return deny('Only the student owner can add attachments.');
		if (isResolved(grievance))
			return deny('Resolved grievances cannot be edited.', 409);
		if (isWithdrawn(grievance))
			return deny('Withdrawn grievances cannot be edited.', 409);
		return ALLOWED;
	},

	/**
	 * DOWNLOAD / VIEW an attachment.
	 * Students may only access attachments for their own grievances.
	 */
	canViewAttachment(user: SessionUser, grievance: GrievanceRow): PolicyResult {
		if (isWarden(user)) return ALLOWED;
		if (isStudent(user) && isOwner(user, grievance)) return ALLOWED;
		return deny('You are not authorized to access this attachment.');
	},

	/**
	 * WITHDRAW (soft-delete) a grievance.
	 * Only the owning student may withdraw, and only while not resolved.
	 */
	canWithdraw(user: SessionUser, grievance: GrievanceRow): PolicyResult {
		if (isWarden(user)) return deny('Wardens cannot withdraw student grievances.');
		if (!isOwner(user, grievance))
			return deny('Only the student owner can withdraw this grievance.');
		if (isResolved(grievance))
			return deny('Resolved grievances cannot be withdrawn.', 409);
		if (isWithdrawn(grievance))
			return deny('This grievance has already been withdrawn.', 409);
		return ALLOWED;
	},

	/**
	 * ARCHIVE a resolved grievance.
	 * Only wardens may archive, and only after resolution.
	 */
	canArchive(user: SessionUser, grievance: GrievanceRow): PolicyResult {
		if (!isWarden(user)) return deny('Only wardens can archive grievances.');
		if (!isResolved(grievance))
			return deny('Only resolved grievances can be archived.', 409);
		if (isArchived(grievance))
			return deny('This grievance is already archived.', 409);
		return ALLOWED;
	},

	/**
	 * FILE a new grievance.
	 * Only students may file grievances.
	 */
	canCreate(user: SessionUser): PolicyResult {
		if (isStudent(user)) return ALLOWED;
		return deny('Only students can file grievances.');
	},

	/**
	 * VIEW audit logs (admin-only endpoint).
	 * Only wardens may access audit trails.
	 */
	canViewAuditLogs(user: SessionUser): PolicyResult {
		if (isWarden(user)) return ALLOWED;
		return deny('Only wardens can view audit logs.');
	},

	/**
	 * VIEW all notifications for a user.
	 * Users may only view their own notifications.
	 */
	canViewNotifications(user: SessionUser, targetUserId: string): PolicyResult {
		if (user.id === targetUserId) return ALLOWED;
		if (isWarden(user)) return ALLOWED;
		return deny('You can only view your own notifications.');
	}
};
