import app from 'index';
import { sendMail } from 'lib/mailer';
import type { Locale } from 'lib/locale';

/// The mails this backend sends. Each has a template per language under
/// `templates/mail/<kind>/<locale>.njk` and a subject per language here.
export type MailKind =
	'email-verification' | 'password-reset' | 'organisation-invitation';

const SUBJECTS: Record<MailKind, Record<Locale, string>> = {
	'email-verification': {
		en: 'Confirm your email address',
		de: 'E-Mail-Adresse bestätigen',
	},
	'password-reset': {
		en: 'Reset your password',
		de: 'Zurücksetzen des Passworts',
	},
	'organisation-invitation': {
		en: 'Workspace invitation',
		de: 'Workspace-Einladung',
	},
};

export async function sendTemplatedMail(
	kind: MailKind,
	to: string,
	locale: Locale,
	data: Record<string, unknown>
) {
	const html = await app.view(`mail/${kind}/${locale}.njk`, data);
	// `kind` and `locale` are closed unions, not input.
	// eslint-disable-next-line security/detect-object-injection
	await sendMail(to, SUBJECTS[kind][locale], html);
}
