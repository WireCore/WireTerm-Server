import { describe, expect, it, vi } from 'vitest';
import { JwksCache, TokenError, createVerifier } from '../../src/lib/wirecloud';
import { AUDIENCE, ISSUER, NOW, jwksOf, makeKey, signToken } from './helpers';
import type { TestKey } from './helpers';

const URL_ = 'http://wirecloud.test/.well-known/jwks.json';

/// A network you can control: the JWKS changes, calls are counted, and it
/// can go down.
function fakeNetwork(initial: TestKey[]) {
	const state = {
		keys: initial,
		calls: 0,
		fail: false,
		status: 200,
		body: undefined as string | undefined,
	};
	const fetchImpl = vi.fn(async () => {
		state.calls++;
		if (state.fail) throw new Error('network down');
		return new Response(
			state.body ?? JSON.stringify(jwksOf(...state.keys)),
			{
				status: state.status,
			}
		);
	}) as unknown as typeof fetch;
	return { state, fetchImpl };
}

function setup(keys: TestKey[], clock = { ms: NOW.getTime() }) {
	const network = fakeNetwork(keys);
	const cache = new JwksCache({
		url: URL_,
		fetchImpl: network.fetchImpl,
		now: () => clock.ms,
		ttlMs: 3_600_000,
		unknownKidRefreshMinIntervalMs: 30_000,
	});
	const verifier = createVerifier({
		issuer: ISSUER,
		audience: AUDIENCE,
		keys: cache,
		now: () => new Date(clock.ms),
	});
	return { ...network, cache, verifier, clock };
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

describe('JwksCache', () => {
	it('loads the JWKS once and uses it for all further checks', async () => {
		const key = await makeKey('k1');
		const { verifier, state } = setup([key]);
		for (let i = 0; i < 5; i++) {
			await verifier.verify(await signToken({ key }));
		}
		expect(state.calls).toBe(1);
	});

	it('refreshes once it is no longer fresh', async () => {
		const key = await makeKey('k1');
		const { verifier, state, clock } = setup([key]);
		await verifier.verify(await signToken({ key }));
		clock.ms += 3_600_001;
		await verifier.verify(
			await signToken({
				key,
				issuedAt: Math.floor(clock.ms / 1000),
				expiresAt: Math.floor(clock.ms / 1000) + 600,
			})
		);
		expect(state.calls).toBe(2);
	});

	it('keeps the old JWKS if WireCloud does not answer on refresh', async () => {
		const key = await makeKey('k1');
		const { verifier, state, clock } = setup([key]);
		await verifier.verify(await signToken({ key }));

		state.fail = true;
		clock.ms += 3_600_001;
		const token = await signToken({
			key,
			issuedAt: Math.floor(clock.ms / 1000),
			expiresAt: Math.floor(clock.ms / 1000) + 600,
		});
		expect(await kindOf(verifier.verify(token))).toBe('accepted');
	});

	it('reports jwks_unavailable if there never was a JWKS', async () => {
		const key = await makeKey('k1');
		const { verifier, state } = setup([key]);
		state.fail = true;
		expect(await kindOf(verifier.verify(await signToken({ key })))).toBe(
			'jwks_unavailable'
		);
	});

	it.each([
		['error status', { status: 500 }],
		['no JSON', { body: 'not json' }],
		['without keys', { body: '{"foo":1}' }],
		['keys not an array', { body: '{"keys":"x"}' }],
		['too large', { body: 'x'.repeat(70_000) }],
	])('rejects an unusable response: %s', async (_name, change) => {
		const key = await makeKey('k1');
		const { verifier, state } = setup([key]);
		Object.assign(state, change);
		expect(await kindOf(verifier.verify(await signToken({ key })))).toBe(
			'jwks_unavailable'
		);
	});

	it('does not reload right after loading, not even for an unknown kid', async () => {
		const first = await makeKey('k1');
		const next = await makeKey('k2');
		const { verifier, state } = setup([first]);
		await verifier.verify(await signToken({ key: first }));
		expect(state.calls).toBe(1);

		// WireCloud has published a new key in advance, but the minimum
		// interval since the last load has not passed yet: the tool does not
		// ask again and rejects the unknown kid.
		state.keys = [first, next];
		const token = await signToken({ key: next });
		expect(await kindOf(verifier.verify(token))).toBe('unknown_key');
		expect(state.calls).toBe(1);
	});

	it('reloads for an unknown kid once the minimum interval has passed', async () => {
		const first = await makeKey('k1');
		const next = await makeKey('k2');
		const { verifier, state, clock } = setup([first]);
		await verifier.verify(await signToken({ key: first }));

		state.keys = [first, next];
		clock.ms += 31_000;
		const issued = Math.floor(clock.ms / 1000);
		const token = await signToken({
			key: next,
			issuedAt: issued,
			expiresAt: issued + 600,
		});
		expect(await kindOf(verifier.verify(token))).toBe('accepted');
		expect(state.calls).toBe(2);
	});

	it('reloads for made-up kids at most once per minimum interval', async () => {
		const key = await makeKey('k1');
		const { verifier, state, clock } = setup([key]);
		await verifier.verify(await signToken({ key }));
		expect(state.calls).toBe(1);

		clock.ms += 31_000;
		for (let i = 0; i < 20; i++) {
			await kindOf(
				verifier.verify(await signToken({ key, kid: `made-up-${i}` }))
			);
		}
		// One reload for the first, all others are throttled.
		expect(state.calls).toBe(2);

		clock.ms += 31_000;
		await kindOf(
			verifier.verify(await signToken({ key, kid: 'one-more' }))
		);
		expect(state.calls).toBe(3);
	});

	it('merges concurrent load attempts into one', async () => {
		const key = await makeKey('k1');
		const { verifier, state } = setup([key]);
		const token = await signToken({ key });
		await Promise.all(
			Array.from({ length: 10 }, () => verifier.verify(token))
		);
		expect(state.calls).toBe(1);
	});

	it('holds on to a superseded key as long as it is in the JWKS', async () => {
		const first = await makeKey('k1');
		const next = await makeKey('k2');
		const { verifier, state, clock } = setup([first, next]);
		const oldToken = await signToken({ key: first });
		await verifier.verify(oldToken);

		// The old key stays in the JWKS (phase-out), an old token remains valid.
		clock.ms += 31_000;
		state.keys = [first, next];
		expect(
			await kindOf(
				verifier.verify(
					await signToken({
						key: first,
						issuedAt: Math.floor(clock.ms / 1000),
						expiresAt: Math.floor(clock.ms / 1000) + 600,
					})
				)
			)
		).toBe('accepted');
	});
});
