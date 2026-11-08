import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AUDIENCE,
	ISSUER,
	NOW,
	NOW_SECONDS,
	TestKey,
	jwksOf,
	makeKey,
	signToken,
} from './helpers';
import { HttpError } from '../../src/utils/http';

const syncFromClaims = vi.fn();

let key: TestKey;

async function load() {
	vi.resetModules();
	vi.stubEnv('WIRECLOUD_ISSUER', ISSUER);
	vi.stubEnv('WIRECLOUD_AUDIENCE', AUDIENCE);
	vi.doMock('../../src/services/WireCloudSyncService', () => ({
		syncFromClaims,
	}));
	vi.doMock('../../src/services/WorkspaceService', () => ({
		ensurePersonalWorkspace: vi.fn(),
	}));
	return import('../../src/services/WireCloudAuth');
}

const request = (authorization?: string) =>
	({
		headers: authorization ? { authorization } : {},
		log: { warn: vi.fn() },
	}) as never;

beforeEach(async () => {
	key = await makeKey('k1');
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(jwksOf(key))))
	);
	syncFromClaims.mockReset();
	syncFromClaims.mockResolvedValue('user-1');
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('requireWireCloudUser', () => {
	it('answers 401 without a header', async () => {
		const { requireWireCloudUser } = await load();
		await expect(requireWireCloudUser(request())).rejects.toMatchObject({
			status: 401,
		});
		expect(syncFromClaims).not.toHaveBeenCalled();
	});

	it('answers garbage with 401 without syncing anything', async () => {
		const { requireWireCloudUser } = await load();
		for (const header of [
			'Bearer garbage',
			'Bearer a.b.c',
			'Basic abc',
			'Bearer',
		]) {
			const error = await requireWireCloudUser(request(header)).catch(
				(e: unknown) => e
			);
			expect(error).toMatchObject({ status: 401 });
		}
		expect(syncFromClaims).not.toHaveBeenCalled();
	});

	it('rejects a token with the wrong key', async () => {
		const { requireWireCloudUser } = await load();
		const other = await makeKey('k1');
		const token = await signToken({ key: other });
		await expect(
			requireWireCloudUser(request(`Bearer ${token}`))
		).rejects.toMatchObject({ status: 401 });
		expect(syncFromClaims).not.toHaveBeenCalled();
	});

	it('returns the local user ID for a valid token', async () => {
		const { requireWireCloudUser } = await load();
		const token = await signToken({ key });
		const userId = await requireWireCloudUser(request(`Bearer ${token}`));
		expect(userId).toBe('user-1');
		expect(syncFromClaims).toHaveBeenCalledTimes(1);
		expect(syncFromClaims.mock.calls[0][0]).toMatchObject({
			subject: 'acc-1',
			tokenId: 'jti-1',
		});
	});

	it('syncs the same token only once', async () => {
		const { requireWireCloudUser } = await load();
		const token = await signToken({ key });
		await requireWireCloudUser(request(`Bearer ${token}`));
		await requireWireCloudUser(request(`Bearer ${token}`));
		expect(syncFromClaims).toHaveBeenCalledTimes(1);
	});

	it('syncs a newer token again', async () => {
		const { requireWireCloudUser } = await load();
		await requireWireCloudUser(
			request(`Bearer ${await signToken({ key, jti: 'a' })}`)
		);
		await requireWireCloudUser(
			request(
				`Bearer ${await signToken({ key, jti: 'b', issuedAt: NOW_SECONDS + 5 })}`
			)
		);
		expect(syncFromClaims).toHaveBeenCalledTimes(2);
	});

	it('does not roll back the state with an older token', async () => {
		const { requireWireCloudUser } = await load();
		await requireWireCloudUser(
			request(
				`Bearer ${await signToken({ key, jti: 'new', issuedAt: NOW_SECONDS })}`
			)
		);
		const userId = await requireWireCloudUser(
			request(
				`Bearer ${await signToken({ key, jti: 'old', issuedAt: NOW_SECONDS - 120 })}`
			)
		);
		expect(userId).toBe('user-1');
		expect(syncFromClaims).toHaveBeenCalledTimes(1);
	});

	it('syncs accounts independently of each other', async () => {
		const { requireWireCloudUser } = await load();
		await requireWireCloudUser(
			request(`Bearer ${await signToken({ key, subject: 'acc-1' })}`)
		);
		await requireWireCloudUser(
			request(`Bearer ${await signToken({ key, subject: 'acc-2' })}`)
		);
		expect(syncFromClaims).toHaveBeenCalledTimes(2);
	});

	it('passes sync errors on unchanged', async () => {
		const { requireWireCloudUser } = await load();
		syncFromClaims.mockRejectedValue(new HttpError(409, 'WC-EC' as never));
		const token = await signToken({ key });
		await expect(
			requireWireCloudUser(request(`Bearer ${token}`))
		).rejects.toMatchObject({ status: 409 });
		// A failed sync does not count as done.
		syncFromClaims.mockResolvedValue('user-1');
		await requireWireCloudUser(request(`Bearer ${token}`));
		expect(syncFromClaims).toHaveBeenCalledTimes(2);
	});
});
