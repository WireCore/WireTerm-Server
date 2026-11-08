import { describe, expect, test } from 'vitest';
import { APIError } from 'better-auth/api';
import { call } from '../helpers/app';
import { auth } from '../helpers/auth';

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

describe('password reset page', () => {
	test('shows the form in the browser language', async () => {
		const de = await call('GET', '/reset-password/abc123', {
			headers: { 'accept-language': 'de-DE,de;q=0.9' },
		});
		expect(de.statusCode).toBe(200);
		expect(de.headers['cache-control']).toBe('no-store');
		expect(de.body).toContain('Neues Passwort setzen');

		const en = await call('GET', '/reset-password/abc123');
		expect(en.body).toContain('Set a new password');
	});

	test('sets the password with the token from the link', async () => {
		auth.api.resetPassword.mockResolvedValue({ status: true });

		const response = await call('POST', '/reset-password/abc123', {
			headers: FORM,
			payload: 'password=a-new-password&repeat=a-new-password',
		});

		expect(auth.api.resetPassword).toHaveBeenCalledWith({
			body: { newPassword: 'a-new-password', token: 'abc123' },
		});
		expect(response.body).toContain('Password changed');
	});

	test('two different passwords never reach better-auth', async () => {
		const response = await call('POST', '/reset-password/abc123', {
			headers: FORM,
			payload: 'password=one-password&repeat=another-one',
		});

		expect(auth.api.resetPassword).not.toHaveBeenCalled();
		expect(response.body).toContain('are not the same');
	});

	test('an expired token and a short password each get their message', async () => {
		auth.api.resetPassword.mockRejectedValueOnce(
			new APIError('BAD_REQUEST', { code: 'INVALID_TOKEN' })
		);
		const expired = await call('POST', '/reset-password/abc123', {
			headers: FORM,
			payload: 'password=a-new-password&repeat=a-new-password',
		});
		expect(expired.body).toContain('invalid or has expired');

		auth.api.resetPassword.mockRejectedValueOnce(
			new APIError('BAD_REQUEST', { code: 'PASSWORD_TOO_SHORT' })
		);
		const short = await call('POST', '/reset-password/abc123', {
			headers: FORM,
			payload: 'password=x&repeat=x',
		});
		expect(short.body).toContain('too short or too long');
	});

	test('a token with unexpected characters is refused', async () => {
		const response = await call('GET', '/reset-password/abc%3Cscript%3E');
		expect(response.statusCode).toBe(400);
	});
});

describe('invitation page', () => {
	test('shows the link to paste into WireTerm', async () => {
		const response = await call('GET', '/organization/acceptinvite/inv-1');

		expect(response.statusCode).toBe(200);
		expect(response.body).toContain('/organization/acceptinvite/inv-1');
		expect(response.body).toContain('Add workspace');
	});
});
