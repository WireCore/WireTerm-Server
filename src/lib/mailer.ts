import nodemailer from 'nodemailer';
import {
	SMTP_FROM,
	SMTP_HOST,
	SMTP_PASSWORD,
	SMTP_PORT,
	SMTP_SECURE,
	SMTP_TLS_SERVERNAME,
	SMTP_USERNAME,
} from 'globals';

// One transport for all of the backend's mails. Without it every place that
// sends one would have the same seven lines of configuration.
export function transport() {
	return nodemailer.createTransport({
		host: SMTP_HOST,
		port: SMTP_PORT,
		secure: SMTP_SECURE,
		auth: SMTP_USERNAME
			? { user: SMTP_USERNAME, pass: SMTP_PASSWORD }
			: undefined,
		tls: {
			servername: SMTP_TLS_SERVERNAME,
		},
	});
}

const ENTITIES = new Map([
	['&amp;', '&'],
	['&lt;', '<'],
	['&gt;', '>'],
	['&quot;', '"'],
	['&#39;', "'"],
	['&nbsp;', ' '],
]);

/// The plain-text part of a mail, for clients that show no HTML: paragraphs
/// and headings become blank lines, a link becomes "label: URL", every other
/// tag disappears. Enough for the backend's own templates, not a general
/// converter.
export function htmlToText(html: string): string {
	return (
		html
			.replace(/<(head|style|script)\b[\s\S]*?<\/\1\s*>/gi, '')
			// Line breaks in the markup are formatting, not text.
			.replace(/\s+/g, ' ')
			.replace(
				/<a\b[^>]*?href="([^"]*)"[^>]*>(.*?)<\/a\s*>/gi,
				(_, href: string, label: string) =>
					`${label.replace(/<[^>]+>/g, '').trim()}: ${href}`
			)
			.replace(/<\/(p|h[1-6]|div|li)\s*>|<br\s*\/?>/gi, '\n\n')
			.replace(/<[^>]+>/g, '')
			.replace(
				/&(amp|lt|gt|quot|#39|nbsp);/g,
				(entity) => ENTITIES.get(entity) ?? entity
			)
			.split('\n')
			.map((line) => line.trim())
			.join('\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

export async function sendMail(to: string, subject: string, html: string) {
	await transport().sendMail({
		from: SMTP_FROM,
		to,
		subject,
		text: htmlToText(html),
		html,
	});
}
