import { FastifyRequest } from 'fastify';
import prisma from 'database';
import { auth } from 'lib/auth';
import {
	AdminClaims,
	JwksCache,
	TokenError,
	WireCloudClaims,
	createAdminVerifier,
	createVerifier,
} from 'lib/wirecloud';
import { ensurePersonalWorkspace } from 'services/WorkspaceService';
import { syncFromClaims } from 'services/WireCloudSyncService';
import { linkLocalAccount } from 'services/WireCloudLinkService';
import {
	WIRECLOUD_AUDIENCE,
	WIRECLOUD_ISSUER,
	WIRECLOUD_JWKS_URL,
} from 'globals';
import { forbidden, notAuthenticated } from 'utils/http';

/// Sign-in in `AUTH_MODE=wirecloud`: the person identifies with a token from
/// WireCloud (`Authorization: Bearer ...`). The token is verified with the
/// reusable module `lib/wirecloud`, after which `WireCloudSyncService` syncs
/// the stored state.

type Verifier = ReturnType<typeof createVerifier>;
let keys: JwksCache | undefined;
let verifier: Verifier | undefined;
let adminVerifier: ReturnType<typeof createAdminVerifier> | undefined;

/// The instance's identifier is the one value without a default: it is
/// PUBLIC_URL unless WIRECLOUD_AUDIENCE says otherwise.
function audience(): string {
	if (!WIRECLOUD_AUDIENCE)
		throw new Error('PUBLIC_URL is missing (AUTH_MODE=wirecloud)');
	return WIRECLOUD_AUDIENCE;
}

/// Aborts startup if the mode is selected but the settings are missing.
/// Without this the error would only show up on the first request.
export function assertWireCloudConfig() {
	audience();
}

/// User and admin tokens are signed with the same keys and therefore share
/// one JWKS cache.
function verifierOptions() {
	keys ??= new JwksCache({ url: WIRECLOUD_JWKS_URL });
	return { issuer: WIRECLOUD_ISSUER, audience: audience(), keys };
}

function getVerifier(): Verifier {
	verifier ??= createVerifier(verifierOptions());
	return verifier;
}

/// Verifies the admin token of a request from WireCloud and requires a
/// permission. If the token is missing or does not fit: 401; if only the
/// permission is missing: 403.
export async function requireWireCloudAdmin(
	request: FastifyRequest,
	scope: string
): Promise<AdminClaims> {
	const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '');
	if (!match) throw notAuthenticated();
	adminVerifier ??= createAdminVerifier(verifierOptions());
	let claims: AdminClaims;
	try {
		claims = await adminVerifier.verify(match[1]);
	} catch (error) {
		if (error instanceof TokenError) {
			request.log.warn(
				{ kind: error.kind },
				'WireCloud admin token rejected'
			);
			throw notAuthenticated();
		}
		throw error;
	}
	if (!claims.scopes.includes(scope)) throw forbidden();
	return claims;
}

export function wireCloudIssuer(): string {
	return WIRECLOUD_ISSUER;
}

/// Last synced tokens per account. Two reasons:
///
/// - The same token (same `jti`) needs the sync only once; otherwise every
///   request within ten minutes costs a dozen queries.
/// - An **older** token must not reset the stored state to an earlier one: if
///   someone was removed from a company and the new token already reflects
///   that, a straggler with the old token does not recreate the membership.
///   The memory applies per instance.
const lastSynced = new Map<
	string,
	{ issuedAt: number; tokenId: string; userId: string }
>();
const MAX_TRACKED = 10_000;

function remember(claims: WireCloudClaims, userId: string) {
	if (lastSynced.size >= MAX_TRACKED) {
		const cutoff = Math.floor(Date.now() / 1000) - 3600;
		for (const [subject, entry] of lastSynced) {
			if (entry.issuedAt < cutoff) lastSynced.delete(subject);
		}
	}
	lastSynced.set(claims.subject, {
		issuedAt: claims.issuedAt,
		tokenId: claims.tokenId,
		userId,
	});
}

async function createUser(input: {
	email: string;
	name: string;
	emailVerified: boolean;
}) {
	const context = await auth.$context;
	return context.internalAdapter.createUser(input, { method: 'wirecloud' });
}

/// Verifies the request's token and returns its claims. Anything that does
/// not fit is a 401; the reason is only in the log.
async function verifyRequest(
	request: FastifyRequest
): Promise<WireCloudClaims> {
	const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '');
	if (!match) throw notAuthenticated();

	try {
		return await getVerifier().verify(match[1]);
	} catch (error) {
		if (error instanceof TokenError) {
			// The reason goes into the log, not into the response.
			request.log.warn({ kind: error.kind }, 'WireCloud token rejected');
			throw notAuthenticated();
		}
		throw error;
	}
}

/// Links a local account with the token's WireCloud account, after
/// confirmation with the local password (see `WireCloudLinkService`).
export async function linkWireCloudAccount(
	request: FastifyRequest,
	password: string
) {
	const claims = await verifyRequest(request);
	return linkLocalAccount(claims, password, {
		prisma,
		verifyPassword: async (hash, candidate) =>
			(await auth.$context).password.verify({
				hash,
				password: candidate,
			}),
		ensurePersonalWorkspace: (id) => ensurePersonalWorkspace(auth, id),
	});
}

export async function requireWireCloudUser(
	request: FastifyRequest
): Promise<string> {
	const claims = await verifyRequest(request);

	const known = lastSynced.get(claims.subject);
	if (
		known &&
		(known.tokenId === claims.tokenId || known.issuedAt > claims.issuedAt)
	) {
		return known.userId;
	}

	const userId = await syncFromClaims(claims, {
		prisma,
		createUser,
		ensurePersonalWorkspace: (id) => ensurePersonalWorkspace(auth, id),
	});
	remember(claims, userId);
	return userId;
}
