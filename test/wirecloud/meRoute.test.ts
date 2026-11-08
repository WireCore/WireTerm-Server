import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AUDIENCE,
	ISSUER,
	NOW,
	TestKey,
	jwksOf,
	makeKey,
	signToken,
} from './helpers';
import { ErrorCodes } from '../../src/utils/ErrorCodes';

const syncFromClaims = vi.fn();
let key: TestKey;

async function load(mode = 'wirecloud') {
	vi.resetModules();
	vi.stubEnv('AUTH_MODE', mode);
	vi.stubEnv('WIRECLOUD_ISSUER', ISSUER);
	vi.stubEnv('WIRECLOUD_AUDIENCE', AUDIENCE);
	vi.doMock('../../src/services/WireCloudSyncService', () => ({
		syncFromClaims,
	}));
	vi.doMock('../../src/services/WorkspaceService', async (original) => ({
		...(await original<
			typeof import('../../src/services/WorkspaceService')
		>()),
		ensurePersonalWorkspace: vi.fn(),
	}));
	const { call } = await import('../helpers/app');
	const { prismaMock } = await import('../helpers/prisma');
	// After `resetModules`, `HttpError` is a new class; an error from the
	// static import would fail the error handler's `instanceof`.
	const { conflict } = await import('../../src/utils/http');
	return { call, prismaMock, conflict };
}

const bearer = async () => ({
	authorization: `Bearer ${await signToken({ key })}`,
});

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
	vi.doUnmock('../../src/services/WireCloudSyncService');
	vi.doUnmock('../../src/services/WorkspaceService');
});

describe('GET /api/wirecloud/me', () => {
	it('returns the local identity for the token', async () => {
		const { call, prismaMock } = await load();
		prismaMock.user.findUnique.mockResolvedValue({
			id: 'user-1',
			name: 'Max Muster',
			email: 'max@example.test',
		});

		const response = await call('GET', '/api/wirecloud/me', {
			headers: await bearer(),
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			id: 'user-1',
			name: 'Max Muster',
			email: 'max@example.test',
		});
		expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
			where: { id: 'user-1' },
			select: { id: true, name: true, email: true },
		});
	});

	it('answers 401 without a token', async () => {
		const { call } = await load();
		const response = await call('GET', '/api/wirecloud/me');
		expect(response.statusCode).toBe(401);
		expect(syncFromClaims).not.toHaveBeenCalled();
	});

	it('reports a not yet linked local account with WC-EC like any other route', async () => {
		const { call, conflict } = await load();
		syncFromClaims.mockRejectedValue(
			conflict(ErrorCodes.WIRECLOUD_EMAIL_CONFLICT)
		);

		const response = await call('GET', '/api/wirecloud/me', {
			headers: await bearer(),
		});

		expect(response.statusCode).toBe(409);
		expect(response.json()).toMatchObject({ code: 'WC-EC' });
	});

	it('answers 401 when the user no longer exists', async () => {
		const { call, prismaMock } = await load();
		prismaMock.user.findUnique.mockResolvedValue(null);

		const response = await call('GET', '/api/wirecloud/me', {
			headers: await bearer(),
		});

		expect(response.statusCode).toBe(401);
	});

	it('does not exist in local mode', async () => {
		const { call } = await load('local');
		const response = await call('GET', '/api/wirecloud/me');
		expect(response.statusCode).toBe(404);
	});
});

describe('GET /api/workspaces in WireCloud mode', () => {
	it('names the WireCloud company of each organization that stands for one', async () => {
		const { call, prismaMock } = await load();
		prismaMock.member.findMany.mockResolvedValue([
			{
				role: 'owner',
				organization: {
					id: 'org-personal',
					name: 'Personal',
					slug: 'personal-user-1',
					metadata: JSON.stringify({ kind: 'personal' }),
					revision: 1n,
				},
			},
			{
				role: 'member',
				organization: {
					id: 'org-acme',
					name: 'Acme GmbH',
					slug: 'company-c1',
					metadata: JSON.stringify({ kind: 'company' }),
					revision: 2n,
				},
			},
		]);
		prismaMock.externalRef.findMany.mockResolvedValue([
			{ localId: 'org-acme', externalId: 'company-1' },
		]);

		const response = await call('GET', '/api/workspaces', {
			headers: await bearer(),
		});

		expect(response.statusCode).toBe(200);
		const workspaces =
			response.json<{ id: string; wirecloudCompany: string | null }[]>();
		expect(workspaces.map((w) => [w.id, w.wirecloudCompany])).toEqual([
			['org-personal', null],
			['org-acme', 'company-1'],
		]);
		// Only mappings of this server's own WireCloud count.
		expect(prismaMock.externalRef.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					entityType: 'organization',
					issuer: ISSUER,
				}),
			})
		);
	});
});
