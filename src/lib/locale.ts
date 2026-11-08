/// Languages for the backend's mails and the name of the personal workspace.
/// The desktop client offers the same two.
export const LOCALES = ['en', 'de'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/// `de`, `de-DE` and `DE_at` become a supported locale, anything else
/// `undefined`.
export function toLocale(value: unknown): Locale | undefined {
	if (typeof value !== 'string') return undefined;
	const primary = value.trim().toLowerCase().split(/[-_]/)[0];
	return (LOCALES as readonly string[]).includes(primary)
		? (primary as Locale)
		: undefined;
}

/// The first supported language in `Accept-Language`, in the order given.
/// Weights (`q=`) are ignored on purpose: with two languages the order a
/// client sends them in says enough.
export function localeFromAcceptLanguage(
	header: string | null | undefined
): Locale | undefined {
	if (!header) return undefined;
	for (const part of header.split(',')) {
		const locale = toLocale(part.split(';')[0]);
		if (locale) return locale;
	}
	return undefined;
}

/// The locale of an account, or the default if it has none.
export function resolveLocale(value: unknown): Locale {
	return toLocale(value) ?? DEFAULT_LOCALE;
}
