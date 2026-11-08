import type { JWTPayload } from 'jose';
import { TokenError } from './errors';

/// The contract versions this module understands (VERTRAG.md 6.2).
export const SUPPORTED_VERSIONS: readonly number[] = [1];

export type WireCloudTeam = { id: string; name: string };

/// An entry from `wc.memberships`: a company in which the person has access to
/// this tool.
export type WireCloudMembership = {
	company: string;
	name: string;
	toolRole: string;
	teams: WireCloudTeam[];
};

export type WireCloudClaims = {
	issuer: string;
	/// Stable identifier of the account at WireCloud, never the email.
	subject: string;
	audience: string;
	issuedAt: number;
	expiresAt: number;
	tokenId: string;
	version: number;
	account: {
		type: 'personal' | 'managed';
		/// Display name. Older tokens have none: then it is the part of the
		/// email before the `@`, so that an account is never created without a
		/// name.
		name: string;
		email: string;
		emailVerified: boolean;
		/// Set when a platform administrator impersonates the account.
		impersonatedBy?: string;
	};
	memberships: WireCloudMembership[];
	/// The teams in the token are truncated; the list is not complete.
	teamsTruncated: boolean;
};

const MAX_ID = 191;
const MAX_NAME = 255;
const MAX_ROLE = 64;
const MAX_MEMBERSHIPS = 100;
const MAX_TEAMS_TOTAL = 200;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > max) {
		throw new TokenError('malformed');
	}
	return value;
}

/// Strictly checks the shape of the claims and turns them into the types
/// above. Whatever does not fit is `malformed`: a token issued by WireCloud
/// always has this shape. Unknown additional claims are ignored, so that the
/// contract can be extended without raising the version.
export function parseClaims(payload: JWTPayload): WireCloudClaims {
	const { iss, sub, aud, iat, exp, jti } = payload;
	const audience = Array.isArray(aud) ? aud[0] : aud;
	if (
		typeof iss !== 'string' ||
		typeof audience !== 'string' ||
		typeof iat !== 'number' ||
		typeof exp !== 'number'
	) {
		throw new TokenError('malformed');
	}

	const { ver, acct, wc } = payload as Record<string, unknown>;
	if (typeof ver !== 'number' || !Number.isInteger(ver)) {
		throw new TokenError('malformed');
	}
	if (!isObject(acct) || !isObject(wc)) throw new TokenError('malformed');
	if (acct.type !== 'personal' && acct.type !== 'managed') {
		throw new TokenError('malformed');
	}
	if (typeof acct.email_verified !== 'boolean') {
		throw new TokenError('malformed');
	}
	if (
		!Array.isArray(wc.memberships) ||
		wc.memberships.length > MAX_MEMBERSHIPS
	) {
		throw new TokenError('malformed');
	}

	let teamsTotal = 0;
	const memberships = wc.memberships.map(
		(raw: unknown): WireCloudMembership => {
			if (!isObject(raw) || !Array.isArray(raw.teams)) {
				throw new TokenError('malformed');
			}
			teamsTotal += raw.teams.length;
			if (teamsTotal > MAX_TEAMS_TOTAL) throw new TokenError('malformed');
			return {
				company: text(raw.company, MAX_ID),
				name: text(raw.name, MAX_NAME),
				toolRole: text(raw.tool_role, MAX_ROLE),
				teams: raw.teams.map((team: unknown): WireCloudTeam => {
					if (!isObject(team)) throw new TokenError('malformed');
					return {
						id: text(team.id, MAX_ID),
						name: text(team.name, MAX_NAME),
					};
				}),
			};
		}
	);

	// A company may appear only once: otherwise it would be unclear which role applies.
	if (
		new Set(memberships.map((m) => m.company)).size !== memberships.length
	) {
		throw new TokenError('malformed');
	}

	return {
		issuer: iss,
		subject: text(sub, MAX_ID),
		audience,
		issuedAt: iat,
		expiresAt: exp,
		tokenId: text(jti, MAX_ID),
		version: ver,
		account: {
			type: acct.type,
			name:
				typeof acct.name === 'string' && acct.name.length > 0
					? text(acct.name, MAX_NAME)
					: text(acct.email, MAX_NAME).split('@')[0] || 'WireCloud',
			email: text(acct.email, MAX_NAME),
			emailVerified: acct.email_verified,
			...(typeof acct.impersonated_by === 'string'
				? { impersonatedBy: acct.impersonated_by }
				: {}),
		},
		memberships,
		teamsTruncated: wc.teams_truncated === true,
	};
}
