import type { PrismaClient } from 'generated/prisma/client';
import type { WireCloudClaims } from 'lib/wirecloud';
import { ErrorCodes } from 'utils/ErrorCodes';
import { HttpError } from 'utils/http';

/// Links an **existing local account** with a WireCloud account
/// (VERTRAG.md 8.2). The sync never does that on its own: with a foreign
/// issuer the same address does not prove that it is the same person. Here the
/// person proves it themselves, with two things at once:
///
/// - a valid WireCloud token with a **verified** address (they confirmed the
///   mailbox in WireCloud) and
/// - the sign-in password of the local account (they know the account).
///
/// One alone is not enough: whoever only verifies an address in WireCloud
/// does not know the local password, and whoever only knows the password
/// still needs the mailbox.
///
/// WireTerm's encryption is unaffected by this: the account keeps its keys
/// and the master password.

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

/// Failed attempts per WireCloud account, in memory only (per instance). Keeps
/// password guessing small; a hard limit across instances needs shared
/// storage.
const failures = new Map<string, number[]>();

export function resetLinkAttempts() {
	failures.clear();
}

function recent(key: string, now: number): number[] {
	const hits = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
	if (hits.length > 0) failures.set(key, hits);
	else failures.delete(key);
	return hits;
}

export type LinkDeps = {
	prisma: PrismaClient;
	/// Checks a password against better-auth's hash.
	verifyPassword: (hash: string, password: string) => Promise<boolean>;
	/// Creates "Personal" if it is still missing (idempotent).
	ensurePersonalWorkspace: (userId: string) => Promise<void>;
	now?: () => number;
};

export async function linkLocalAccount(
	claims: WireCloudClaims,
	password: string,
	deps: LinkDeps
): Promise<{ linked: true }> {
	const { prisma } = deps;
	const now = (deps.now ?? Date.now)();
	const limitKey = `${claims.issuer}\n${claims.subject}`;

	if (recent(limitKey, now).length >= MAX_FAILURES) {
		throw new HttpError(429, ErrorCodes.WIRECLOUD_LINK_RATE_LIMITED);
	}
	const deny = () => {
		failures.set(limitKey, [...recent(limitKey, now), now]);
		return new HttpError(403, ErrorCodes.WIRECLOUD_LINK_DENIED);
	};

	if (!claims.account.emailVerified) {
		throw new HttpError(403, ErrorCodes.WIRECLOUD_LINK_UNVERIFIED);
	}

	const existingRef = await prisma.externalRef.findUnique({
		where: {
			entityType_issuer_externalId: {
				entityType: 'user',
				issuer: claims.issuer,
				externalId: claims.subject,
			},
		},
	});
	if (existingRef) {
		const linkedUser = await prisma.user.findUnique({
			where: { id: existingRef.localId },
			select: { id: true },
		});
		// Already linked: nothing to do, nothing to give away.
		if (linkedUser) return { linked: true };
		// Orphaned mapping: the sync cleans it up on the next call.
	}

	const local = await prisma.user.findUnique({
		where: { email: claims.account.email.toLowerCase() },
		select: { id: true },
	});
	if (!local) {
		// No conflict, nothing to link: the next normal call creates the
		// account.
		throw new HttpError(404, ErrorCodes.WIRECLOUD_LINK_NOT_NEEDED);
	}

	// The local account already belongs to another WireCloud account.
	const taken = await prisma.externalRef.findFirst({
		where: {
			entityType: 'user',
			issuer: claims.issuer,
			localId: local.id,
		},
		select: { id: true },
	});
	if (taken) throw deny();

	const credential = await prisma.account.findFirst({
		where: { userId: local.id, providerId: 'credential' },
		select: { password: true },
	});
	if (
		!credential?.password ||
		!(await deps.verifyPassword(credential.password, password))
	) {
		throw deny();
	}

	await prisma.externalRef.create({
		data: {
			entityType: 'user',
			localId: local.id,
			issuer: claims.issuer,
			externalId: claims.subject,
		},
	});
	await deps.ensurePersonalWorkspace(local.id);
	failures.delete(limitKey);
	return { linked: true };
}
