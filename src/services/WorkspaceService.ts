import type { auth as Auth } from 'lib/auth';
import prisma from 'database';
import { DEFAULT_LOCALE, type Locale } from 'lib/locale';

/// Every user gets an organization at sign-up that belongs to them alone. In
/// the client it is called "Personal"; a private user never sees the word
/// "organization".
///
/// Technically it is an organization like any other, with one member in the
/// role `owner`. That is the reason for this approach: sync, permissions and
/// encryption need no second path, and "private" becomes "team" by inviting
/// someone — without a move and without a switch.
export const PERSONAL = 'personal';

/// The personal workspace's name, in the language of its owner at sign-up.
/// Only a default: it can be renamed like any other.
export const PERSONAL_NAMES: Record<Locale, string> = {
	en: 'Personal',
	de: 'Persönlich',
};

/// What `organization.metadata` says about the workspace.
///
/// Accepts both forms: Prisma returns the column as text, while better-auth
/// hands it out already parsed. Whatever cannot be read is an ordinary
/// organization — when in doubt, better one too few than a personal workspace
/// that is not one.
export function workspaceKind(metadata: unknown): 'personal' | 'organization' {
	let value = metadata;
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			return 'organization';
		}
	}
	const kind = (value as { kind?: unknown } | null)?.kind;
	return kind === PERSONAL ? 'personal' : 'organization';
}

/// The slug is unique. Derived from the name, two people with the same name
/// would spoil each other's sign-up — so it comes from the user ID, which
/// exists only once anyway.
export function personalSlug(userId: string): string {
	return `personal-${userId.toLowerCase()}`;
}

/// Creates the personal organization if it does not exist yet.
///
/// `createOrganization` without headers and with `userId` is the way the
/// organization plugin provides for calls by the server itself: it creates
/// organization and membership in one go, instead of two tables being filled
/// by hand here and drifting apart at the library's next update.
export async function ensurePersonalWorkspace(
	auth: typeof Auth,
	userId: string,
	locale: Locale = DEFAULT_LOCALE
): Promise<void> {
	const slug = personalSlug(userId);

	const existing = await prisma.organization.findUnique({ where: { slug } });
	if (existing) return;

	await auth.api.createOrganization({
		body: {
			// eslint-disable-next-line security/detect-object-injection -- `locale` is a closed union
			name: PERSONAL_NAMES[locale],
			slug,
			userId,
			metadata: { kind: PERSONAL },
		},
	});
}
