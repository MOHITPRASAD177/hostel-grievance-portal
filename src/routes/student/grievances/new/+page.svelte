<script lang="ts">
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import AttachmentPicker from '$lib/components/app/attachment-picker.svelte';
	import { grievanceService } from '$lib/services';
	import type { AttachmentInput } from '$lib/services/types';
	import { GRIEVANCE_CATEGORIES, type GrievanceCategory } from '$lib/types';
	import { getSession } from '$lib/stores/auth.svelte';

	let title = $state('');
	let category = $state<GrievanceCategory | ''>('');
	let description = $state('');
	let isAnonymous = $state(false);
	let attachment = $state<AttachmentInput | null>(null);

	let submitted = $state(false);
	let submitting = $state(false);

	const errors = $derived.by(() => {
		const e: { title?: string; category?: string; description?: string } = {};
		if (submitted) {
			if (!title.trim()) e.title = 'Title is required.';
			else if (title.trim().length < 5) e.title = 'Title must be at least 5 characters.';
			if (!category) e.category = 'Please choose a category.';
			if (!description.trim()) e.description = 'Description is required.';
			else if (description.trim().length < 20)
				e.description = 'Please describe the issue in at least 20 characters.';
		}
		return e;
	});

	function handleSelectFile(file: File) {
		attachment = {
			filename: file.name,
			sizeBytes: file.size,
			contentType: file.type || 'application/octet-stream',
			file
		};
	}

	function handleRemoveFile() {
		attachment = null;
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		submitted = true;
		if (Object.keys(errors).length > 0) return;

		const uid = getSession()?.id;
		if (!uid) {
			toast.error('Session unavailable. Please sign in again.');
			return;
		}

		submitting = true;
		const result = await grievanceService.create({
			studentId: uid,
			title: title.trim(),
			category: category as GrievanceCategory,
			description: description.trim(),
			isAnonymous,
			attachment
		});
		submitting = false;

		if (result.ok) {
			toast.success(`Grievance ${result.data.id} filed.`, {
				description: isAnonymous
					? '🎭 Filed in Anonymous Mode. Your identity is hidden from the warden.'
					: 'You can track its status from your grievances list.'
			});
			await goto(`/student/grievances/${result.data.id}`);
		} else {
			toast.error('Could not file the grievance.', { description: result.error });
		}
	}
</script>

<svelte:head><title>New grievance · HostelGrievance</title></svelte:head>

<PageHeader
	title="File a grievance"
	description="Describe the issue clearly so the warden can act on it."
/>

<Card class="max-w-2xl">
	<CardHeader>
		<CardTitle>Grievance details</CardTitle>
		<CardDescription>All fields marked required must be filled.</CardDescription>
	</CardHeader>
	<CardContent>
		<form onsubmit={handleSubmit} class="space-y-5" novalidate>
			<div class="space-y-1.5">
				<Label for="title">Title <span class="text-destructive" aria-hidden="true">*</span></Label>
				<Input
					id="title"
					placeholder="Short summary, e.g. 'Leaking tap in B-204'"
					bind:value={title}
					aria-invalid={errors.title ? 'true' : undefined}
					aria-describedby={errors.title ? 'title-error' : undefined}
				/>
				{#if errors.title}
					<p id="title-error" class="text-destructive text-sm" role="alert">{errors.title}</p>
				{/if}
			</div>

			<div class="space-y-1.5">
				<Label for="category">Category <span class="text-destructive" aria-hidden="true">*</span></Label>
				<Select.Root
					type="single"
					bind:value={category as unknown as string}
					name="category"
				>
					<Select.Trigger
						id="category"
						class="w-full"
						aria-invalid={errors.category ? 'true' : undefined}
					>
						{category || 'Select a category'}
					</Select.Trigger>
					<Select.Content>
						{#each GRIEVANCE_CATEGORIES as c (c)}
							<Select.Item value={c} label={c}>{c}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if errors.category}
					<p class="text-destructive text-sm" role="alert">{errors.category}</p>
				{/if}
			</div>

			<div class="space-y-1.5">
				<Label for="description">Description <span class="text-destructive" aria-hidden="true">*</span></Label>
				<Textarea
					id="description"
					rows={6}
					placeholder="What is happening, where, and since when?"
					bind:value={description}
					aria-invalid={errors.description ? 'true' : undefined}
					aria-describedby={errors.description ? 'description-error' : undefined}
				/>
				{#if errors.description}
					<p id="description-error" class="text-destructive text-sm" role="alert">{errors.description}</p>
				{/if}
			</div>

			<!-- Anonymous Whistleblower Mode UI Toggle -->
			<div class="rounded-lg border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
				<input
					type="checkbox"
					id="isAnonymous"
					bind:checked={isAnonymous}
					class="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
				/>
				<div class="space-y-1">
					<Label for="isAnonymous" class="font-medium cursor-pointer flex items-center gap-2">
						<span>🎭 Submit Anonymously (Whistleblower Mask)</span>
					</Label>
					<p class="text-xs text-muted-foreground">
						Protects your privacy by masking your name, email, and room number (e.g. <code>ANON-4F1A</code>) when viewed by the Warden. You can still track and comment on it from your dashboard.
					</p>
				</div>
			</div>

			<AttachmentPicker
				selected={attachment}
				disabled={submitting}
				onSelect={handleSelectFile}
				onRemove={handleRemoveFile}
			/>

			<div class="flex items-center gap-3">
				<Button type="submit" disabled={submitting}>
					{submitting ? 'Filing…' : 'File grievance'}
				</Button>
				<Button type="button" variant="ghost" href="/student/grievances" disabled={submitting}>
					Cancel
				</Button>
			</div>
		</form>
	</CardContent>
</Card>
