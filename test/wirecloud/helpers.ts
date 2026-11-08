import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import type { CryptoKey, JSONWebKeySet, JWK } from 'jose';
import type { KeySource } from '../../src/lib/wirecloud';

export const ISSUER = 'http://wirecloud.test';
export const AUDIENCE = 'http://wireterm.test';
export const NOW = new Date('2026-10-31T12:00:00Z');
export const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

export type TestKey = {
	kid: string;
	privateKey: CryptoKey;
	publicJwk: JWK;
};

export async function makeKey(kid: string): Promise<TestKey> {
	const { publicKey, privateKey } = await generateKeyPair('EdDSA', {
		extractable: true,
	});
	return {
		kid,
		privateKey,
		publicJwk: {
			...(await exportJWK(publicKey)),
			kid,
			alg: 'EdDSA',
			use: 'sig',
		},
	};
}

export function jwksOf(...keys: TestKey[]): JSONWebKeySet {
	return { keys: keys.map((key) => key.publicJwk) };
}

/// A fixed key source for testing the verifier without a network.
export function staticKeys(...keys: TestKey[]): KeySource {
	return { getKey: createLocalJWKSet(jwksOf(...keys)) };
}

export type ClaimOverrides = Record<string, unknown>;

export function validClaims(overrides: ClaimOverrides = {}) {
	return {
		ver: 1,
		acct: {
			type: 'personal',
			name: 'Max Muster',
			email: 'max@example.test',
			email_verified: true,
		},
		acr: 'pwd',
		amr: ['pwd'],
		wc: {
			memberships: [
				{
					company: 'company-1',
					name: 'Acme GmbH',
					tool_role: 'admin',
					teams: [{ id: 'team-1', name: 'Support' }],
				},
			],
		},
		...overrides,
	};
}

type SignOptions = {
	key: TestKey;
	claims?: ClaimOverrides;
	issuer?: string;
	audience?: string | string[];
	subject?: string | null;
	issuedAt?: number;
	expiresAt?: number;
	jti?: string | null;
	kid?: string;
};

/// Signs a token the way WireCloud does, with adjustable deviations.
export async function signToken(options: SignOptions): Promise<string> {
	const jwt = new SignJWT(validClaims(options.claims))
		.setProtectedHeader({
			alg: 'EdDSA',
			typ: 'JWT',
			kid: options.kid ?? options.key.kid,
		})
		.setIssuer(options.issuer ?? ISSUER)
		.setAudience(options.audience ?? AUDIENCE)
		.setIssuedAt(options.issuedAt ?? NOW_SECONDS)
		.setExpirationTime(options.expiresAt ?? NOW_SECONDS + 600);
	if (options.subject !== null) jwt.setSubject(options.subject ?? 'acc-1');
	if (options.jti !== null) jwt.setJti(options.jti ?? 'jti-1');
	return jwt.sign(options.key.privateKey);
}

type AdminSignOptions = {
	key: TestKey;
	typ?: string;
	scope?: string | null;
	issuer?: string;
	audience?: string;
	issuedAt?: number;
	expiresAt?: number;
	jti?: string | null;
};

/// Signs an admin token the way WireCloud does, with adjustable
/// deviations.
export async function signAdminToken(
	options: AdminSignOptions
): Promise<string> {
	const jwt = new SignJWT(
		options.scope === null ? {} : { scope: options.scope ?? 'events:write' }
	)
		.setProtectedHeader({
			alg: 'EdDSA',
			typ: options.typ ?? 'wc-admin',
			kid: options.key.kid,
		})
		.setIssuer(options.issuer ?? ISSUER)
		.setSubject('wirecloud')
		.setAudience(options.audience ?? AUDIENCE)
		.setIssuedAt(options.issuedAt ?? NOW_SECONDS)
		.setExpirationTime(options.expiresAt ?? NOW_SECONDS + 300);
	if (options.jti !== null) jwt.setJti(options.jti ?? 'adm-1');
	return jwt.sign(options.key.privateKey);
}
