import { afterEach, describe, expect, it, vi } from 'vitest';

async function appIn(mode: string | undefined) {
	vi.resetModules();
	if (mode) vi.stubEnv('AUTH_MODE', mode);
	else vi.stubEnv('AUTH_MODE', '');
	const { auth } = await import('../helpers/auth');
	const { call } = await import('../helpers/app');
	return { auth, call };
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('AUTH_MODE', () => {
	it('provides no /api/auth route in wirecloud mode', async () => {
		const { call, auth } = await appIn('wirecloud');
		const response = await call('GET', '/api/auth/get-session');
		expect(response.statusCode).toBe(404);
		expect(auth.handler).not.toHaveBeenCalled();
	});

	it('requires a token for protected routes in wirecloud mode', async () => {
		const { call } = await appIn('wirecloud');
		const response = await call('GET', '/api/workspaces');
		expect(response.statusCode).toBe(401);
	});

	it('provides linking only in wirecloud mode and requires a token there', async () => {
		const wirecloud = await appIn('wirecloud');
		const denied = await wirecloud.call('POST', '/api/wirecloud/link', {
			payload: { password: 'x' },
		});
		expect(denied.statusCode).toBe(401);
		const bad = await wirecloud.call('POST', '/api/wirecloud/link', {
			payload: {},
		});
		expect(bad.statusCode).toBe(400);

		const local = await appIn(undefined);
		const missing = await local.call('POST', '/api/wirecloud/link', {
			payload: { password: 'x' },
		});
		expect(missing.statusCode).toBe(404);
	});

	it('leaves local mode unchanged', async () => {
		const { call, auth } = await appIn(undefined);
		auth.handler.mockResolvedValue(
			new Response('{}', {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		);
		const response = await call('GET', '/api/auth/get-session');
		expect(response.statusCode).toBe(200);
		expect(auth.handler).toHaveBeenCalled();
	});
});
