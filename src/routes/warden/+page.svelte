<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table/index.js';
	import StatusBadge from '$lib/components/app/status-badge.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import StatCard from '$lib/components/app/stat-card.svelte';
	import EmptyState from '$lib/components/app/empty-state.svelte';
	import ErrorState from '$lib/components/app/error-state.svelte';
	import { grievanceService } from '$lib/services';
	import type { Grievance } from '$lib/types';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';

	let grievances = $state<Grievance[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	let telemetry = $state<{ threatLevel?: string; activeIpBlocks?: number; totalSecurityEventsToday?: number } | null>(null);
	let auditStatus = $state<{ verified?: boolean; status?: string; totalRecords?: number } | null>(null);
	let verifyingLedger = $state(false);

	const openCount = $derived(grievances.filter((g) => g.status === 'Open').length);
	const inProgressCount = $derived(grievances.filter((g) => g.status === 'In Progress').length);
	const resolvedCount = $derived(grievances.filter((g) => g.status === 'Resolved').length);
	const recent = $derived(grievances.slice(0, 5));

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	async function load() {
		loading = true;
		error = null;
		const result = await grievanceService.listAll();
		if (result.ok) {
			grievances = result.data;
		} else {
			error = result.error;
		}
		loading = false;
		loadSecurityTelemetry();
	}

	async function loadSecurityTelemetry() {
		try {
			const res = await fetch('/api/admin/security/telemetry', { credentials: 'include' });
			if (res.ok) {
				const json = await res.json();
				telemetry = json.data;
			}
		} catch {}
	}

	async function verifyAuditChain() {
		verifyingLedger = true;
		try {
			const res = await fetch('/api/admin/audit-logs/verify', { credentials: 'include' });
			if (res.ok) {
				const json = await res.json();
				auditStatus = json.data;
			}
		} catch {}
		verifyingLedger = false;
	}

	load();
</script>

<svelte:head><title>Dashboard · HostelGrievance</title></svelte:head>

<PageHeader title="Warden dashboard" description="Grievances across all hostel students.">
	{#snippet actions()}
		<Button variant="outline" href="/warden/grievances">
			All grievances
			<ArrowRightIcon class="size-4" />
		</Button>
	{/snippet}
</PageHeader>

{#if loading}
	<div class="grid gap-4 sm:grid-cols-4">
		<StatCard label="Loading" loading />
		<StatCard label="Loading" loading />
		<StatCard label="Loading" loading />
		<StatCard label="Loading" loading />
	</div>
{:else if error}
	<ErrorState message={error} onRetry={load} />
{:else}
	<div class="grid gap-4 sm:grid-cols-4">
		<StatCard label="Total" value={grievances.length} href="/warden/grievances" />
		<StatCard label="Open" value={openCount} href="/warden/grievances" />
		<StatCard label="In progress" value={inProgressCount} href="/warden/grievances" />
		<StatCard label="Resolved" value={resolvedCount} href="/warden/grievances" />
	</div>

	<Card class="mt-6">
		<CardHeader class="flex-row items-center justify-between">
			<CardTitle>Recent grievances</CardTitle>
			<Button variant="ghost" size="sm" href="/warden/grievances">
				View all
				<ArrowRightIcon class="size-4" />
			</Button>
		</CardHeader>
		<CardContent>
			{#if recent.length === 0}
				<EmptyState title="No grievances yet" description="Grievances filed by students will appear here." />
			{:else}
				<ul class="divide-y">
					{#each recent as g (g.id)}
						<li>
							<a
								href="/warden/grievances/{g.id}"
								class="hover:bg-muted/50 -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5"
							>
								<div class="min-w-0">
									<p class="truncate text-sm font-medium">{g.title}</p>
									<p class="text-muted-foreground text-xs">
										{g.student.name} · {g.student.room ?? '—'} · {g.category} · {formatDate(g.createdAt)}
									</p>
								</div>
								<StatusBadge status={g.status} />
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</CardContent>
	</Card>

	<Card class="mt-6 border-primary/20">
		<CardHeader class="flex-row items-center justify-between pb-3">
			<div>
				<CardTitle class="flex items-center gap-2">
					<span>🛡️ GrievanceGuard Defense-in-Depth & SecOps Console</span>
				</CardTitle>
				<p class="text-xs text-muted-foreground mt-1">
					Centralized real-time authorization engine, Honeytoken canary monitoring, and cryptographic ledger verification.
				</p>
			</div>
			<div class="flex items-center gap-2">
				<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
					{telemetry?.threatLevel ?? 'DEFCON_5_NORMAL'}
				</span>
			</div>
		</CardHeader>
		<CardContent>
			<div class="grid gap-4 sm:grid-cols-3 mb-4">
				<div class="rounded-lg border p-3 bg-muted/30">
					<p class="text-xs text-muted-foreground font-medium">Active Threat Level</p>
					<p class="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-1">
						{telemetry?.threatLevel ? telemetry.threatLevel.replace(/_/g, ' ') : 'DEFCON 5 NORMAL'}
					</p>
					<p class="text-[11px] text-muted-foreground mt-0.5">Policy Engine: Active & Enforced</p>
				</div>
				<div class="rounded-lg border p-3 bg-muted/30">
					<p class="text-xs text-muted-foreground font-medium">Honeytoken Canary Trap</p>
					<p class="text-lg font-bold text-primary mt-1">GRV-0000 (Armed)</p>
					<p class="text-[11px] text-muted-foreground mt-0.5">Auto-bans adversarial probes for 60m</p>
				</div>
				<div class="rounded-lg border p-3 bg-muted/30">
					<p class="text-xs text-muted-foreground font-medium">Active Quarantined IPs</p>
					<p class="text-lg font-bold {telemetry?.activeIpBlocks ? 'text-destructive' : 'text-foreground'} mt-1">
						{telemetry?.activeIpBlocks ?? 0} Blocked
					</p>
					<p class="text-[11px] text-muted-foreground mt-0.5">Brute-force & flood protection active</p>
				</div>
			</div>

			<div class="rounded-lg border p-4 bg-primary/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
				<div class="space-y-1">
					<h4 class="text-sm font-semibold flex items-center gap-1.5">
						<span>⛓️ Cryptographic Tamper-Evident Audit Ledger</span>
						{#if auditStatus}
							<span class="text-xs px-2 py-0.5 rounded font-mono font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
								{auditStatus.status} ({auditStatus.totalRecords} records chained)
							</span>
						{/if}
					</h4>
					<p class="text-xs text-muted-foreground">
						Every administrative action, status update, and login is cryptographically SHA-256 chained to prevent database alteration.
					</p>
				</div>
				<Button size="sm" variant="outline" onclick={verifyAuditChain} disabled={verifyingLedger}>
					{verifyingLedger ? 'Verifying SHA-256 Hash Chain…' : 'Verify Ledger Integrity'}
				</Button>
			</div>
		</CardContent>
	</Card>
{/if}
