import { browser } from '$app/environment';
import type { Notification } from '$lib/types';

let notifications = $state<Notification[]>([]);
let unreadCount = $state<number>(0);
let loading = $state<boolean>(false);

export function clearNotifications(): void {
	notifications = [];
	unreadCount = 0;
	loading = false;
}

export async function fetchNotifications(): Promise<void> {
	if (!browser) return;
	loading = true;
	try {
		const res = await fetch('/api/notifications', { credentials: 'include' });
		if (res.ok) {
			const json = await res.json();
			notifications = json.data ?? [];
			unreadCount = json.unreadCount ?? 0;
		} else {
			notifications = [];
			unreadCount = 0;
		}
	} catch {
		// Ignore network errors in background poll
	} finally {
		loading = false;
	}
}

export async function markAsRead(id: string): Promise<void> {
	try {
		const res = await fetch(`/api/notifications/${id}/read`, { method: 'POST', credentials: 'include' });
		if (res.ok) {
			notifications = notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n));
			unreadCount = Math.max(0, unreadCount - 1);
		}
	} catch {
		// Ignore error
	}
}

export async function markAllAsRead(): Promise<void> {
	try {
		const res = await fetch('/api/notifications/read-all', { method: 'POST', credentials: 'include' });
		if (res.ok) {
			notifications = notifications.map((n) => ({ ...n, isRead: true }));
			unreadCount = 0;
		}
	} catch {
		// Ignore error
	}
}

export function getNotifications(): Notification[] {
	return notifications;
}

export function getUnreadCount(): number {
	return unreadCount;
}

export function isNotificationLoading(): boolean {
	return loading;
}
