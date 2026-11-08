import { describe, expect, test, vi } from 'vitest';

// Must be set before `globals` is read — `vi.hoisted` runs before the
// imports. Every test file has its own modules, the others do not see this.
vi.hoisted(() => {
	process.env.RATE_LIMIT_MAX = '2';
});

import { call } from '../helpers/app';

describe('rate limit', () => {
	test('answers with 429 and RL once the limit is reached', async () => {
		await call('GET', '/api/workspaces');
		await call('GET', '/api/workspaces');
		const response = await call('GET', '/api/workspaces');

		expect(response.statusCode).toBe(429);
		expect(response.json().code).toBe('RL');
		expect(response.headers['retry-after']).toBeDefined();
	});

	test('the probe is exempt', async () => {
		for (let i = 0; i < 5; i++) {
			const response = await call('GET', '/health');
			expect(response.statusCode).toBe(200);
		}
	});
});
