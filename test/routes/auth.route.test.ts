import { describe, expect, test } from 'vitest';
import { call } from '../helpers/app';
import { auth } from '../helpers/auth';

describe('better-auth route', () => {
	test('passes status, headers and body through', async () => {
		auth.handler.mockResolvedValue(
			new Response(JSON.stringify({ user: null }), {
				status: 401,
				headers: { 'content-type': 'application/json' },
			})
		);

		const response = await call('GET', '/api/auth/get-session');

		expect(response.statusCode).toBe(401);
		expect(response.json()).toEqual({ user: null });
	});

	test('teams go through the same route as everything else from better-auth', async () => {
		auth.handler.mockResolvedValue(
			new Response(JSON.stringify({ id: 'team-1' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		);

		const response = await call(
			'POST',
			'/api/auth/organization/create-team',
			{
				payload: { name: 'Infrastructure' },
			}
		);

		expect(response.statusCode).toBe(200);
		const request = auth.handler.mock.calls[0][0] as Request;
		expect(request.url).toContain('/api/auth/organization/create-team');
	});

	test('better-auth sees the address of the connection, not the one sent along', async () => {
		auth.handler.mockResolvedValue(new Response(null, { status: 200 }));

		await call('POST', '/api/auth/sign-in/email', {
			payload: { email: 'test@test.net', password: 'secret' },
			headers: { 'x-forwarded-for': '203.0.113.7' },
		});

		const request = auth.handler.mock.calls[0][0] as Request;
		// `inject` comes from 127.0.0.1, and without `TRUST_PROXY` only that counts.
		expect(request.headers.get('x-forwarded-for')).toBe('127.0.0.1');
	});

	test('an error in the handler yields 500', async () => {
		auth.handler.mockRejectedValue(new Error('broken'));

		const response = await call('POST', '/api/auth/sign-in/email', {
			payload: { email: 'test@test.net', password: 'secret' },
		});

		expect(response.statusCode).toBe(500);
		expect(response.json().code).toBe('AUTH_FAILURE');
	});
});
