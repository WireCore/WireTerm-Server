import { vi } from 'vitest';

export const USER_ID = 'user-1';
export const OTHER_USER_ID = 'user-2';
export const ORGANIZATION_ID = 'organization-1';
export const API_KEY = 'user_testkey';

let sessionUserId: string | null = null;
let apiKeyUserId: string | null = null;

// Replaces src/lib/auth.ts (see alias in vitest.config.ts): better-auth would
// open a database connection on import.
export const auth = {
	api: {
		getSession: vi.fn(),
		verifyApiKey: vi.fn(),
		resetPassword: vi.fn(),
	},
	handler: vi.fn(),
};

export function loginAs(userId: string = USER_ID) {
	sessionUserId = userId;
}

export function loginWithApiKey(userId: string = USER_ID) {
	apiKeyUserId = userId;
}

export function logout() {
	sessionUserId = null;
	apiKeyUserId = null;
}

export function installAuthMock() {
	logout();

	auth.api.getSession.mockImplementation(async () =>
		sessionUserId === null
			? null
			: { user: { id: sessionUserId }, session: {} }
	);

	auth.api.verifyApiKey.mockImplementation(
		async ({ body }: { body: { key: string } }) =>
			apiKeyUserId === null || body.key !== API_KEY
				? { valid: false, key: null }
				: { valid: true, key: { referenceId: apiKeyUserId } }
	);

	auth.handler.mockResolvedValue(
		new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		})
	);
}
