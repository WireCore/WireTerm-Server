import { describe, expect, it } from 'vitest';
import {
	TokenError,
	createAdminVerifier,
	createVerifier,
} from '../../src/lib/wirecloud';
import {
	AUDIENCE,
	ISSUER,
	NOW,
	NOW_SECONDS,
	makeKey,
	signAdminToken,
	signToken,
	staticKeys,
} from './helpers';

async function setup() {
	const key = await makeKey('kid-1');
	const options = {
		issuer: ISSUER,
		audience: AUDIENCE,
		keys: staticKeys(key),
		now: () => NOW,
	};
	return {
		key,
		admin: createAdminVerifier(options),
		user: createVerifier(options),
	};
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof TokenError) return error.kind;
		throw error;
	}
	return 'ok';
}

describe('admin token', () => {
	it('returns the claims of a valid token', async () => {
		const { key, admin } = await setup();
		const claims = await admin.verify(
			await signAdminToken({ key, scope: 'events:write limits:write' })
		);
		expect(claims).toMatchObject({
			issuer: ISSUER,
			audience: AUDIENCE,
			tokenId: 'adm-1',
			scopes: ['events:write', 'limits:write'],
		});
	});

	it('does not accept a user token as an admin token', async () => {
		const { key, admin } = await setup();
		expect(await kindOf(admin.verify(await signToken({ key })))).toBe(
			'malformed'
		);
	});

	it('does not accept an admin token as a user token', async () => {
		const { key, user } = await setup();
		expect(await kindOf(user.verify(await signAdminToken({ key })))).toBe(
			'malformed'
		);
	});

	it('rejects a different type, even with a genuine signature', async () => {
		const { key, admin } = await setup();
		for (const typ of ['JWT', 'at+jwt', 'wc-admin-x']) {
			expect(
				await kindOf(admin.verify(await signAdminToken({ key, typ })))
			).toBe('malformed');
		}
	});

	it('rejects wrong audience, wrong issuer and a foreign key', async () => {
		const { key, admin } = await setup();
		expect(
			await kindOf(
				admin.verify(
					await signAdminToken({ key, audience: 'http://other' })
				)
			)
		).toBe('invalid_audience');
		expect(
			await kindOf(
				admin.verify(
					await signAdminToken({ key, issuer: 'http://other' })
				)
			)
		).toBe('invalid_issuer');
		const other = await makeKey('kid-1');
		expect(
			await kindOf(admin.verify(await signAdminToken({ key: other })))
		).toBe('invalid_signature');
	});

	it('rejects an expired token, with a small tolerance', async () => {
		const { key, admin } = await setup();
		expect(
			await kindOf(
				admin.verify(
					await signAdminToken({
						key,
						issuedAt: NOW_SECONDS - 400,
						expiresAt: NOW_SECONDS - 100,
					})
				)
			)
		).toBe('expired');
		expect(
			await kindOf(
				admin.verify(
					await signAdminToken({
						key,
						issuedAt: NOW_SECONDS - 305,
						expiresAt: NOW_SECONDS - 5,
					})
				)
			)
		).toBe('ok');
	});

	it('rejects a lifetime longer than 5 minutes', async () => {
		const { key, admin } = await setup();
		expect(
			await kindOf(
				admin.verify(
					await signAdminToken({
						key,
						expiresAt: NOW_SECONDS + 301,
					})
				)
			)
		).toBe('malformed');
	});

	it('rejects a token without jti or scope', async () => {
		const { key, admin } = await setup();
		expect(
			await kindOf(admin.verify(await signAdminToken({ key, jti: null })))
		).toBe('malformed');
		expect(
			await kindOf(
				admin.verify(await signAdminToken({ key, scope: null }))
			)
		).toBe('malformed');
	});

	it('rejects a token issued in the future', async () => {
		const { key, admin } = await setup();
		expect(
			await kindOf(
				admin.verify(
					await signAdminToken({
						key,
						issuedAt: NOW_SECONDS + 120,
						expiresAt: NOW_SECONDS + 300,
					})
				)
			)
		).toBe('not_yet_valid');
	});

	it('rejects garbage and overlong input', async () => {
		const { admin } = await setup();
		for (const value of ['', 'a.b.c', 'x'.repeat(5000)]) {
			expect(await kindOf(admin.verify(value))).toBe('malformed');
		}
	});
});
