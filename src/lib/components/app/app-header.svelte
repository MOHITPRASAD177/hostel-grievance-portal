<script lang="ts">
	import type { User } from '$lib/types';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { signOut } from '$lib/stores/auth.svelte';
	import { activeNavHref, shellNav } from '$lib/components/app/shell-nav';
	import ShellNavLinks from '$lib/components/app/shell-nav-links.svelte';
	import {
		fetchNotifications,
		getNotifications,
		getUnreadCount,
		markAllAsRead,
		markAsRead
	} from '$lib/stores/notifications.svelte';
	import { getTheme, isDarkMode, setTheme } from '$lib/stores/theme.svelte';
	import { toast } from 'svelte-sonner';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import SchoolIcon from '@lucide/svelte/icons/school';
	import BellIcon from '@lucide/svelte/icons/bell';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import CheckCheckIcon from '@lucide/svelte/icons/check-check';

	let { user }: { user: User } = $props();

	const isStudent = $derived(user.role === 'student');
	const nav = $derived(shellNav(user.role));
	const activeHref = $derived(activeNavHref(page.url.pathname, nav));
	let mobileOpen = $state(false);
	let notifsOpen = $state(false);

	const notifications = $derived(getNotifications());
	const unreadCount = $derived(getUnreadCount());
	const darkMode = $derived(isDarkMode());

	onMount(() => {
		fetchNotifications();
		const interval = setInterval(fetchNotifications, 15000);
		return () => clearInterval(interval);
	});

	function toggleTheme() {
		const current = getTheme();
		if (current === 'light') {
			setTheme('dark');
			toast.info('Switched to Dark mode');
		} else if (current === 'dark') {
			setTheme('system');
			toast.info('Switched to System theme');
		} else {
			setTheme('light');
			toast.info('Switched to Light mode');
		}
	}

	async function handleSignOut() {
		mobileOpen = false;
		await signOut();
		toast.success('Signed out successfully');
		await goto('/login', { replaceState: true });
	}

	function timeAgo(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}
</script>

<header
	class="bg-card sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b px-4 sm:px-6"
>
	<div class="flex items-center gap-2">
		<Sheet.Root bind:open={mobileOpen}>
			<Sheet.Trigger
				class="hover:bg-muted -ml-2 inline-flex size-9 items-center justify-center rounded-md md:hidden"
				aria-label="Open navigation menu"
			>
				<MenuIcon class="size-5" />
			</Sheet.Trigger>
			<Sheet.Content side="left" class="w-64">
				<Sheet.Header class="sr-only">
					<Sheet.Title>Navigation</Sheet.Title>
					<Sheet.Description>Main navigation menu</Sheet.Description>
				</Sheet.Header>
				<nav class="mt-4 flex flex-col gap-1 px-3" aria-label="Main navigation">
					<ShellNavLinks items={nav} {activeHref} onNavigate={() => (mobileOpen = false)} />
				</nav>
			</Sheet.Content>
		</Sheet.Root>
		<a href={isStudent ? '/student' : '/warden'} class="flex items-center gap-2 font-semibold">
			<SchoolIcon class="size-5" aria-hidden="true" />
			<span>HostelGrievance</span>
			<span class="text-muted-foreground hidden text-sm font-normal sm:inline">
				· GIET University
			</span>
		</a>
	</div>

	<div class="flex items-center gap-2 sm:gap-3">
		<!-- Dark Mode Toggle -->
		<Button
			variant="ghost"
			size="icon"
			class="size-9 rounded-full"
			onclick={toggleTheme}
			title={`Current theme: ${getTheme()}`}
		>
			{#if darkMode}
				<SunIcon class="size-4" />
			{:else}
				<MoonIcon class="size-4" />
			{/if}
			<span class="sr-only">Toggle theme</span>
		</Button>

		<!-- Notifications Popover Sheet -->
		<Sheet.Root bind:open={notifsOpen}>
			<Sheet.Trigger
				class="hover:bg-muted relative inline-flex size-9 items-center justify-center rounded-full"
				aria-label="Notifications"
			>
				<BellIcon class="size-4" />
				{#if unreadCount > 0}
					<span
						class="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full text-[10px] font-bold"
					>
						{unreadCount > 9 ? '9+' : unreadCount}
					</span>
				{/if}
			</Sheet.Trigger>
			<Sheet.Content side="right" class="w-80 sm:w-96">
				<Sheet.Header class="flex flex-row items-center justify-between border-b pb-3">
					<div>
						<Sheet.Title>Notifications</Sheet.Title>
						<Sheet.Description class="text-xs">
							{unreadCount} unread notification{unreadCount === 1 ? '' : 's'}
						</Sheet.Description>
					</div>
					{#if unreadCount > 0}
						<Button
							variant="ghost"
							size="sm"
							class="text-xs h-7 px-2"
							onclick={async () => {
								await markAllAsRead();
								toast.success('All notifications marked as read');
							}}
						>
							<CheckCheckIcon class="size-3.5 mr-1" />
							Mark all read
						</Button>
					{/if}
				</Sheet.Header>
				<div class="mt-3 flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-8rem)] pr-1">
					{#if notifications.length === 0}
						<p class="text-muted-foreground py-8 text-center text-sm">No notifications yet.</p>
					{:else}
						{#each notifications as notif (notif.id)}
							<div
								class={`rounded-lg border p-3 text-sm transition-colors ${
									notif.isRead ? 'bg-background opacity-75' : 'bg-muted/50 border-primary/30 font-medium'
								}`}
							>
								<div class="flex items-start justify-between gap-2">
									<p class="font-semibold text-xs leading-tight">{notif.title}</p>
									<span class="text-muted-foreground text-[10px] whitespace-nowrap">
										{timeAgo(notif.createdAt)}
									</span>
								</div>
								<p class="text-muted-foreground mt-1 text-xs">{notif.message}</p>
								<div class="mt-2 flex items-center justify-between">
									{#if notif.grievanceId}
										<a
											href={isStudent
												? `/student/grievances/${notif.grievanceId}`
												: `/warden/grievances/${notif.grievanceId}`}
											class="text-primary hover:underline text-xs"
											onclick={async () => {
												if (!notif.isRead) await markAsRead(notif.id);
												notifsOpen = false;
											}}
										>
											View grievance →
										</a>
									{/if}
									{#if !notif.isRead}
										<button
											class="text-muted-foreground hover:text-foreground text-[11px]"
											onclick={() => markAsRead(notif.id)}
										>
											Mark read
										</button>
									{/if}
								</div>
							</div>
						{/each}
					{/if}
				</div>
			</Sheet.Content>
		</Sheet.Root>

		<div class="hidden text-right sm:block">
			<p class="text-sm leading-tight font-medium">{user.name}</p>
			<p class="text-muted-foreground text-xs leading-tight capitalize">{user.role}</p>
		</div>

		<Button variant="outline" size="sm" onclick={handleSignOut}>
			<LogOutIcon class="size-4" />
			<span class="hidden sm:inline">Sign out</span>
		</Button>
	</div>
</header>
