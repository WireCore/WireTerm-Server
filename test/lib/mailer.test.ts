import { readFileSync } from 'node:fs';
import nunjucks from 'nunjucks';
import { describe, expect, test } from 'vitest';
import { htmlToText } from '../../src/lib/mailer';

describe('plain-text part of a mail', () => {
	test('keeps the text and turns the button into label and URL', () => {
		// A fixed path inside the repository.

		const template = readFileSync(
			new URL(
				'../../src/templates/mail/password-reset/en.njk',
				import.meta.url
			),
			'utf8'
		);
		const html = nunjucks.renderString(template, {
			resetlink: 'https://wireterm.example/reset-password/abc?x=1&y=2',
		});

		const text = htmlToText(html);

		expect(text).toContain('Reset your password');
		expect(text).toContain(
			'Reset password: https://wireterm.example/reset-password/abc?x=1&y=2'
		);
		expect(text).toContain('Your master password is not affected.');
		expect(text).not.toMatch(/<|style=/);
	});

	test('separates paragraphs with a blank line', () => {
		expect(htmlToText('<h1>Title</h1>\n<p>One\n  line</p><p>Two</p>')).toBe(
			'Title\n\nOne line\n\nTwo'
		);
	});
});
