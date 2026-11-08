import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import {
	TokenError,
	createVerifier,
	parseClaims,
} from '../../src/lib/wirecloud';
import {
	AUDIENCE,
	ISSUER,
	NOW,
	NOW_SECONDS,
	makeKey,
	signToken,
	staticKeys,
	validClaims,
} from './helpers';

async function setup() {
	const key = await makeKey('kid-1');
	const verifier = createVerifier({
		issuer: ISSUER,
		audience: AUDIENCE,
		keys: staticKeys(key),
		now: () => NOW,
	});
	return { key, verifier };
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof TokenError) return error.kind;
		throw error;
	}
	return 'accepted';
}

describe('valid token', () => {
	it('returns the claims in the shape of the contract', async () => {
		const { key, verifier } = await setup();
		const claims = await verifier.verify(await signToken({ key }));

		expect(claims).toEqual({
			issuer: ISSUER,
			subject: 'acc-1',
			audience: AUDIENCE,
			issuedAt: NOW_SECONDS,
			expiresAt: NOW_SECONDS + 600,
			tokenId: 'jti-1',
			version: 1,
			account: {
				type: 'personal',
				name: 'Max Muster',
				email: 'max@example.test',
				emailVerified: true,
			},
			memberships: [
				{
					company: 'company-1',
					name: 'Acme GmbH',
					toolRole: 'admin',
					teams: [{ id: 'team-1', name: 'Support' }],
				},
			],
			teamsTruncated: false,
		});
	});

	it('accepts a token without a company (private use)', async () => {
		const { key, verifier } = await setup();
		const claims = await verifier.verify(
			await signToken({
				key,
				claims: validClaims({ wc: { memberships: [] } }),
			})
		);
		expect(claims.memberships).toEqual([]);
	});

	it('takes over impersonation and truncated teams', async () => {
		const { key, verifier } = await setup();
		const claims = await verifier.verify(
			await signToken({
				key,
				claims: validClaims({
					acct: {
						type: 'managed',
						name: 'Max',
						email: 'max@example.test',
						email_verified: false,
						impersonated_by: 'admin-1',
					},
					wc: { memberships: [], teams_truncated: true },
				}),
			})
		);
		expect(claims.account).toMatchObject({
			type: 'managed',
			emailVerified: false,
			impersonatedBy: 'admin-1',
		});
		expect(claims.teamsTruncated).toBe(true);
	});

	it('derives a name from the address when the token has none', async () => {
		const { key, verifier } = await setup();
		const claims = await verifier.verify(
			await signToken({
				key,
				claims: validClaims({
					acct: {
						type: 'personal',
						email: 'anna.schmidt@example.test',
						email_verified: true,
					},
				}),
			})
		);
		expect(claims.account.name).toBe('anna.schmidt');
	});

	it('ignores unknown additional claims', async () => {
		const { key, verifier } = await setup();
		const claims = await verifier.verify(
			await signToken({ key, claims: validClaims({ future: { x: 1 } }) })
		);
		expect(claims.subject).toBe('acc-1');
	});
});

describe('signature and key (criterion 6)', () => {
	it('rejects a token signed with a different key', async () => {
		const { verifier } = await setup();
		const attacker = await makeKey('kid-1'); // same kid, different key
		expect(
			await kindOf(verifier.verify(await signToken({ key: attacker })))
		).toBe('invalid_signature');
	});

	it('rejects an unknown kid', async () => {
		const { key, verifier } = await setup();
		expect(
			await kindOf(
				verifier.verify(await signToken({ key, kid: 'unknown' }))
			)
		).toBe('unknown_key');
	});

	it('rejects alg none', async () => {
		const { verifier } = await setup();
		const header = Buffer.from(
			JSON.stringify({ alg: 'none', typ: 'JWT', kid: 'kid-1' })
		).toString('base64url');
		const payload = Buffer.from(
			JSON.stringify({
				...validClaims(),
				iss: ISSUER,
				sub: 'acc-1',
				aud: AUDIENCE,
				iat: NOW_SECONDS,
				exp: NOW_SECONDS + 600,
				jti: 'jti-1',
			})
		).toString('base64url');
		expect(await kindOf(verifier.verify(`${header}.${payload}.`))).toBe(
			'malformed'
		);
	});

	it('rejects confusion with a shared secret (HS256)', async () => {
		const { key, verifier } = await setup();
		// An attacker uses the public key as the HMAC secret.
		const secret = new TextEncoder().encode(JSON.stringify(key.publicJwk));
		const token = await new SignJWT(validClaims())
			.setProtectedHeader({ alg: 'HS256', kid: 'kid-1' })
			.setIssuer(ISSUER)
			.setAudience(AUDIENCE)
			.setSubject('acc-1')
			.setJti('x')
			.setIssuedAt(NOW_SECONDS)
			.setExpirationTime(NOW_SECONDS + 600)
			.sign(secret);
		expect(await kindOf(verifier.verify(token))).toBe('malformed');
	});

	it('rejects garbage and overlong input', async () => {
		const { verifier } = await setup();
		expect(await kindOf(verifier.verify('not-a-token'))).toBe('malformed');
		expect(await kindOf(verifier.verify(''))).toBe('malformed');
		expect(await kindOf(verifier.verify('a'.repeat(9000)))).toBe(
			'malformed'
		);
	});
});

describe('issuer and audience (criterion 6)', () => {
	it('rejects a wrong issuer', async () => {
		const { key, verifier } = await setup();
		expect(
			await kindOf(
				verifier.verify(
					await signToken({
						key,
						issuer: 'http://other-issuer.test',
					})
				)
			)
		).toBe('invalid_issuer');
	});

	it('rejects a wrong audience', async () => {
		const { key, verifier } = await setup();
		expect(
			await kindOf(
				verifier.verify(
					await signToken({
						key,
						audience: 'http://other-tool.test',
					})
				)
			)
		).toBe('invalid_audience');
	});

	it('rejects when its own audience is not in the list', async () => {
		const { key, verifier } = await setup();
		expect(
			await kindOf(
				verifier.verify(
					await signToken({
						key,
						audience: ['http://a.test', 'http://b.test'],
					})
				)
			)
		).toBe('invalid_audience');
	});
});

describe('time (criteria 6 and 7)', () => {
	it('rejects an expired token', async () => {
		const { key, verifier } = await setup();
		const token = await signToken({
			key,
			issuedAt: NOW_SECONDS - 700,
			expiresAt: NOW_SECONDS - 100,
		});
		expect(await kindOf(verifier.verify(token))).toBe('expired');
	});

	it('tolerates a small clock skew on expiry, but no more', async () => {
		const { key, verifier } = await setup();
		const justExpired = await signToken({
			key,
			issuedAt: NOW_SECONDS - 600,
			expiresAt: NOW_SECONDS - 30, // within the 60 s
		});
		const tooOld = await signToken({
			key,
			issuedAt: NOW_SECONDS - 600,
			expiresAt: NOW_SECONDS - 90, // outside
		});
		expect(await kindOf(verifier.verify(justExpired))).toBe('accepted');
		expect(await kindOf(verifier.verify(tooOld))).toBe('expired');
	});

	it('rejects a token issued too far in the future', async () => {
		const { key, verifier } = await setup();
		const token = await signToken({
			key,
			issuedAt: NOW_SECONDS + 3600,
			expiresAt: NOW_SECONDS + 4200,
		});
		expect(await kindOf(verifier.verify(token))).toBe('not_yet_valid');
	});

	it('rejects a lifetime longer than allowed', async () => {
		const { key, verifier } = await setup();
		const token = await signToken({
			key,
			issuedAt: NOW_SECONDS,
			expiresAt: NOW_SECONDS + 86_400,
		});
		expect(await kindOf(verifier.verify(token))).toBe('malformed');
	});

	it('never accepts an expired token, even without tolerance', async () => {
		const key = await makeKey('kid-1');
		const strict = createVerifier({
			issuer: ISSUER,
			audience: AUDIENCE,
			keys: staticKeys(key),
			clockSkewSeconds: 0,
			now: () => new Date((NOW_SECONDS + 601) * 1000),
		});
		expect(await kindOf(strict.verify(await signToken({ key })))).toBe(
			'expired'
		);
	});
});

describe('contract version and shape (criterion 6)', () => {
	it('rejects an unknown contract version', async () => {
		const { key, verifier } = await setup();
		expect(
			await kindOf(
				verifier.verify(
					await signToken({ key, claims: validClaims({ ver: 2 }) })
				)
			)
		).toBe('unsupported_version');
	});

	it.each([
		['without ver', { ver: undefined }],
		['ver as text', { ver: '1' }],
		['without acct', { acct: undefined }],
		[
			'acct.type unknown',
			{ acct: { type: 'x', email: 'a@b.test', email_verified: true } },
		],
		[
			'email_verified missing',
			{ acct: { type: 'personal', email: 'a@b.test' } },
		],
		['without wc', { wc: undefined }],
		['memberships not an array', { wc: { memberships: 'x' } }],
		[
			'company without tool_role',
			{
				wc: {
					memberships: [{ company: 'c', name: 'n', teams: [] }],
				},
			},
		],
		[
			'the same company twice',
			{
				wc: {
					memberships: [
						{
							company: 'c',
							name: 'n',
							tool_role: 'member',
							teams: [],
						},
						{
							company: 'c',
							name: 'n',
							tool_role: 'admin',
							teams: [],
						},
					],
				},
			},
		],
		[
			'too many teams',
			{
				wc: {
					memberships: [
						{
							company: 'c',
							name: 'n',
							tool_role: 'member',
							teams: Array.from({ length: 201 }, (_, i) => ({
								id: `t${i}`,
								name: 'T',
							})),
						},
					],
				},
			},
		],
	])('rejects %s', async (_name, claims) => {
		const { key, verifier } = await setup();
		expect(
			await kindOf(
				verifier.verify(
					await signToken({ key, claims: validClaims(claims) })
				)
			)
		).toBe('malformed');
	});

	it('rejects a token without sub or jti', async () => {
		const { key, verifier } = await setup();
		expect(
			await kindOf(
				verifier.verify(await signToken({ key, subject: null }))
			)
		).toBe('malformed');
		expect(
			await kindOf(verifier.verify(await signToken({ key, jti: null })))
		).toBe('malformed');
	});
});

describe('parseClaims', () => {
	it('throws malformed for an empty object', () => {
		expect(() => parseClaims({})).toThrow(TokenError);
	});
});
