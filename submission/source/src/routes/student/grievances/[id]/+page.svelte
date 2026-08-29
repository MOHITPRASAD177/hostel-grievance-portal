<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import StatusBadge from '$lib/components/app/status-badge.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import ErrorState from '$lib/components/app/error-state.svelte';
	import DetailSkeleton from '$lib/components/app/detail-skeleton.svelte';
	import CommentTimeline from '$lib/components/app/comment-timeline.svelte';
	import CommentForm from '$lib/components/app/comment-form.svelte';
	import AttachmentCard from '$lib/components/app/attachment-card.svelte';
	import { commentService, grievanceService } from '$lib/services';
	import { getSession } from '$lib/stores/auth.svelte';
	import type { Grievance } from '$lib/types';
	import { toast } from 'svelte-sonner';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	const grievanceId = $derived(page.params.id ?? '');

	let grievance = $state<Grievance | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let notFound = $state(false);
	let commenting = $state(false);
	let withdrawing = $state(false);

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleString('en-IN', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	async function load() {
		loading = true;
		error = null;
		notFound = false;
		const result = await grievanceService.getById(grievanceId);
		if (result.ok) {
			grievance = result.data;
		} else {
			grievance = null;
			notFound = true;
		}
		loading = false;
	}

	$effect(() => {
		if (grievanceId) load();
	});

	async function handleAddComment(body: string): Promise<boolean> {
		const uid = getSession()?.id;
		if (!uid || !grievance) return false;
		commenting = true;
		const result = await commentService.add(grievance.id, uid, body);
		commenting = false;
		if (result.ok) {
			grievance = { ...grievance, comments: [...grievance.comments, result.data], updatedAt: grievance.updatedAt };
			toast.success('Comment posted');
			return true;
		}
		toast.error(result.error || 'Failed to post comment');
		return false;
	}

	async function handleWithdraw() {
		if (!grievance) return;
		if (!confirm('Are you sure you want to withdraw this grievance? It will be removed from your active list.')) {
			return;
		}
		withdrawing = true;
		const res = await grievanceService.withdraw(grievance.id);
		withdrawing = false;
		if (res.ok) {
			toast.success('Grievance withdrawn successfully');
			await goto('/student/grievances');
		} else {
			toast.error(res.error || 'Failed to withdraw grievance');
		}
	}
</script>

<svelte:head><title>Grievance {grievanceId} · HostelGrievance</title></svelte:head>

<div class="mb-4">
	<Button variant="ghost" size="sm" href="/student/grievances">
		<ArrowLeftIcon class="size-4" />
		Back to my grievances
	</Button>
</div>

{#if loading}
	<DetailSkeleton />
{:else if notFound}
	<ErrorState
		title="Grievance not found"
		message="This grievance does not exist or may have been removed."
	/>
	<div class="mt-4">
		<Button variant="outline" href="/student/grievances">Return to list</Button>
	</div>
{:else if error}
	<ErrorState message={error} onRetry={load} />
{:else if grievance}
	{@const g = grievance}
	<PageHeader title={g.title}>
		{#snippet actions()}
			<div class="flex items-center gap-2">
				<StatusBadge status={g.status} />
				{#if g.status !== 'Resolved' && !g.deletedAt}
					<Button
						variant="outline"
						size="sm"
						class="text-destructive hover:bg-destructive/10"
						disabled={withdrawing}
						onclick={handleWithdraw}
					>
						<Trash2Icon class="size-3.5 mr-1" />
						Withdraw
					</Button>
				{/if}
			</div>
		{/snippet}
	</PageHeader>

	<div class="grid gap-6 lg:grid-cols-3">
		<div class="space-y-6 lg:col-span-2">
			<Card>
				<CardHeader>
					<CardTitle>Details</CardTitle>
				</CardHeader>
				<CardContent class="space-y-4">
					<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
						<div>
							<dt class="text-muted-foreground text-xs">Grievance ID</dt>
							<dd class="font-mono text-xs">{grievance.id}</dd>
						</div>
						<div>
							<dt class="text-muted-foreground text-xs">Category</dt>
							<dd>{grievance.category}</dd>
						</div>
						<div>
							<dt class="text-muted-foreground text-xs">Filed on</dt>
							<dd>{formatDate(grievance.createdAt)}</dd>
						</div>
						<div>
							<dt class="text-muted-foreground text-xs">Last updated</dt>
							<dd>{formatDate(grievance.updatedAt)}</dd>
						</div>
					</dl>
					<Separator />
					<div>
						<h2 class="mb-1 text-sm font-medium">Description</h2>
						<p class="text-sm whitespace-pre-line">{grievance.description}</p>
					</div>
					{#if grievance.attachments.length > 0}
						<div>
							<h2 class="mb-2 text-sm font-medium">Attachments</h2>
							<div class="grid gap-2 sm:grid-cols-2">
								{#each grievance.attachments as att (att.id)}
									<AttachmentCard attachment={att} />
								{/each}
							</div>
						</div>
					{/if}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Comments</CardTitle>
				</CardHeader>
				<CardContent class="space-y-5">
					<CommentTimeline comments={grievance.comments} />
					<Separator />
					<CommentForm onSubmit={handleAddComment} submitting={commenting} />
				</CardContent>
			</Card>
		</div>

		<div class="space-y-4">
			<Card class="py-4">
				<CardContent class="px-4">
					<h2 class="text-sm font-medium">Status</h2>
					<p class="text-muted-foreground mt-2 text-sm">
						Only the warden can change the status of a grievance. You will receive notifications when updates are made.
					</p>
				</CardContent>
			</Card>
		</div>
	</div>
{/if}
