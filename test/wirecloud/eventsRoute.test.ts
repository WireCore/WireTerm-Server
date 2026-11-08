import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AUDIENCE,
	ISSUER,
	NOW,
	TestKey,
	jwksOf,
	makeKey,
	signAdminToken,
	signToken,
} from './helpers';

const applyEvents = vi.fn();
let key: TestKey;

async function load() {
	vi.resetModules();
	vi.stubEnv('AUTH_MODE', 'wirecloud');
	vi.stubEnv('WIRECLOUD_ISSUER', ISSUER);
	vi.stubEnv('WIRECLOUD_AUDIENCE', AUDIENCE);
	vi.stubEnv('WIRECLOUD_URL', 'https://api.wirecloud.example/');
	vi.doMock('../../src/services/WireCloudEventService', async (original) => ({
		...(await original<
			typeof import('../../src/services/WireCloudEventService')
		>()),
		applyEvents,
	}));
	const { call } = await import('../helpers/app');
	return call;
}

const body = {
	events: [
		{
			id: 'e1',
			type: 'membership.revoked',
			sequence: 1,
			company: 'c1',
			account: 'a1',
		},
	],
};

beforeEach(async () => {
	key = await makeKey('k1');
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(jwksOf(key))))
	);
	applyEvents.mockReset();
	applyEvents.mockResolvedValue({ applied: 1, ignored: 0, rejected: 0 });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.doUnmock('../../src/services/WireCloudEventService');
});

describe('POST /wc/v1/events', () => {
	it('applies events with a valid admin token', async () => {
		const call = await load();
		const response = await call('POST', '/wc/v1/events', {
			payload: body,
			headers: {
				authorization: `Bearer ${await signAdminToken({ key })}`,
			},
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({
			applied: 1,
			ignored: 0,
			rejected: 0,
		});
		expect(applyEvents).toHaveBeenCalledTimes(1);
		expect(applyEvents.mock.calls[0][0]).toEqual(body.events);
		expect(applyEvents.mock.calls[0][1]).toMatchObject({ issuer: ISSUER });
	});

	it('requires a token and applies nothing without a valid one', async () => {
		const call = await load();
		const none = await call('POST', '/wc/v1/events', { payload: body });
		expect(none.statusCode).toBe(401);

		// A user token with a genuine signature is not an admin token.
		const user = await call('POST', '/wc/v1/events', {
			payload: body,
			headers: { authorization: `Bearer ${await signToken({ key })}` },
		});
		expect(user.statusCode).toBe(401);

		const other = await makeKey('k1');
		const forged = await call('POST', '/wc/v1/events', {
			payload: body,
			headers: {
				authorization: `Bearer ${await signAdminToken({ key: other })}`,
			},
		});
		expect(forged.statusCode).toBe(401);
		expect(applyEvents).not.toHaveBeenCalled();
	});

	it('requires the events:write permission', async () => {
		const call = await load();
		const response = await call('POST', '/wc/v1/events', {
			payload: body,
			headers: {
				authorization: `Bearer ${await signAdminToken({ key, scope: 'limits:write' })}`,
			},
		});
		expect(response.statusCode).toBe(403);
		expect(applyEvents).not.toHaveBeenCalled();
	});

	it('checks the shape of the input', async () => {
		const call = await load();
		const headers = {
			authorization: `Bearer ${await signAdminToken({ key })}`,
		};
		for (const payload of [
			{},
			{ events: [] },
			{ events: [{ id: 'x', type: 'org.deleted' }] },
			{ events: [{ id: 'x', type: 'org.deleted', sequence: -1 }] },
			{
				events: Array.from({ length: 101 }, (_, i) => ({
					id: `e${i}`,
					type: 'org.deleted',
					sequence: i,
				})),
			},
		]) {
			const response = await call('POST', '/wc/v1/events', {
				payload,
				headers,
			});
			expect(response.statusCode).toBe(400);
		}
		expect(applyEvents).not.toHaveBeenCalled();
	});
});

describe('GET /.well-known/wirecloud-tool.json', () => {
	it('describes the tool without signing in', async () => {
		const call = await load();
		const response = await call('GET', '/.well-known/wirecloud-tool.json');
		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			contract_version: 1,
			tool: 'wireterm',
			audience: AUDIENCE,
			// Without a trailing slash, however it is configured.
			wirecloud_url: 'https://api.wirecloud.example',
			role_keys: ['owner', 'admin', 'member'],
			project_shares: 'tool',
			events: expect.arrayContaining(['membership.revoked']),
		});
	});

	it('and the routes do not exist in local mode', async () => {
		vi.resetModules();
		vi.stubEnv('AUTH_MODE', '');
		const { call } = await import('../helpers/app');
		expect(
			(await call('GET', '/.well-known/wirecloud-tool.json')).statusCode
		).toBe(404);
		expect(
			(await call('POST', '/wc/v1/events', { payload: body })).statusCode
		).toBe(404);
	});
});
