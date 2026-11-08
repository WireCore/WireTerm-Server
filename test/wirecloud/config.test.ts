import { afterEach, describe, expect, it, vi } from 'vitest';

async function globals(env: Record<string, string>) {
	vi.resetModules();
	for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
	return import('../../src/globals');
}

afterEach(() => vi.unstubAllEnvs());

describe('WireCloud settings', () => {
	it('point to the hosted WireCloud without any setting', async () => {
		const g = await globals({
			WIRECLOUD_URL: '',
			WIRECLOUD_ISSUER: '',
			WIRECLOUD_AUDIENCE: '',
			PUBLIC_URL: 'https://wireterm.example.com',
		});

		expect(g.WIRECLOUD_URL).toBe('https://api.cloud.wirecore.net');
		expect(g.WIRECLOUD_ISSUER).toBe('https://api.cloud.wirecore.net');
		expect(g.WIRECLOUD_JWKS_URL).toBe(
			'https://api.cloud.wirecore.net/.well-known/jwks.json'
		);
		expect(g.WIRECLOUD_AUDIENCE).toBe('https://wireterm.example.com');
	});

	it('take a separate issuer for development, keys come from there', async () => {
		const g = await globals({
			WIRECLOUD_URL: 'http://localhost:8200/',
			WIRECLOUD_ISSUER: 'http://wirecloud_backend:8080',
			WIRECLOUD_AUDIENCE: 'http://wireterm_backend:8080',
		});

		expect(g.WIRECLOUD_URL).toBe('http://localhost:8200');
		expect(g.WIRECLOUD_JWKS_URL).toBe(
			'http://wirecloud_backend:8080/.well-known/jwks.json'
		);
		expect(g.WIRECLOUD_AUDIENCE).toBe('http://wireterm_backend:8080');
	});
});
