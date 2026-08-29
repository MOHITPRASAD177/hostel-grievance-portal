import { browser } from '$app/environment';

export type Theme = 'light' | 'dark' | 'system';

let currentTheme = $state<Theme>('system');
let resolvedDark = $state<boolean>(false);

export function initTheme(): void {
	if (!browser) return;
	const stored = localStorage.getItem('hg_theme') as Theme | null;
	if (stored === 'light' || stored === 'dark' || stored === 'system') {
		currentTheme = stored;
	}
	applyTheme(currentTheme);

	// Listen for system theme changes
	const media = window.matchMedia('(prefers-color-scheme: dark)');
	media.addEventListener('change', () => {
		if (currentTheme === 'system') {
			applyTheme('system');
		}
	});
}

function applyTheme(t: Theme): void {
	if (!browser) return;
	const isDark =
		t === 'dark' ||
		(t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

	resolvedDark = isDark;
	if (isDark) {
		document.documentElement.classList.add('dark');
	} else {
		document.documentElement.classList.remove('dark');
	}
}

export function setTheme(t: Theme): void {
	currentTheme = t;
	if (browser) {
		localStorage.setItem('hg_theme', t);
		applyTheme(t);
	}
}

export function getTheme(): Theme {
	return currentTheme;
}

export function isDarkMode(): boolean {
	return resolvedDark;
}
