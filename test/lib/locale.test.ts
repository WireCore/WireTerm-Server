import { describe, expect, test } from 'vitest';
import {
	localeFromAcceptLanguage,
	resolveLocale,
	toLocale,
} from '../../src/lib/locale';

describe('locale', () => {
	test('regional variants map to a supported locale', () => {
		expect(toLocale('de-DE')).toBe('de');
		expect(toLocale('EN_us')).toBe('en');
		expect(toLocale('fr')).toBeUndefined();
		expect(toLocale(42)).toBeUndefined();
	});

	test('Accept-Language yields the first supported language in order', () => {
		expect(localeFromAcceptLanguage('fr-FR, de;q=0.8, en;q=0.9')).toBe(
			'de'
		);
		expect(localeFromAcceptLanguage('fr, es')).toBeUndefined();
		expect(localeFromAcceptLanguage(undefined)).toBeUndefined();
	});

	test('an account without a language gets the default', () => {
		expect(resolveLocale(null)).toBe('en');
		expect(resolveLocale('de')).toBe('de');
	});
});
