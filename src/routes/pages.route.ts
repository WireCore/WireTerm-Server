import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { APIError } from 'better-auth/api';
import { auth } from 'lib/auth';
import { PUBLIC_URL } from 'globals';
import { localeFromAcceptLanguage, resolveLocale } from 'lib/locale';

/// The two pages the links in mails lead to, so that they work without a web
/// frontend of one's own: setting a new sign-in password, and an invitation
/// that is taken over into the desktop client. In the browser's language.
///
/// Only in local mode; in WireCloud mode WireCloud sends no such mails here.

const TOKEN = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,256}$' } as const;

type ResetState = 'form' | 'mismatch' | 'length' | 'invalid' | 'done';

function render(
	request: FastifyRequest,
	reply: FastifyReply,
	page: 'reset-password' | 'invitation',
	data: Record<string, unknown>
) {
	const locale = resolveLocale(
		localeFromAcceptLanguage(request.headers['accept-language'])
	);
	// The reset link carries a secret; nothing of it belongs in a cache.
	reply.header('cache-control', 'no-store');
	return reply.view(`page/${page}/${locale}.njk`, data);
}

export default (fastify: FastifyInstance) => {
	fastify.register(async (scope) => {
		// A plain HTML form posts URL-encoded; only these pages accept that.
		scope.addContentTypeParser(
			'application/x-www-form-urlencoded',
			{ parseAs: 'string' },
			(_request, body, done) =>
				done(
					null,
					Object.fromEntries(new URLSearchParams(String(body)))
				)
		);

		scope.get<{ Params: { token: string } }>(
			'/reset-password/:token',
			{
				schema: {
					hide: true,
					params: { type: 'object', properties: { token: TOKEN } },
				},
			},
			(request, reply) =>
				render(request, reply, 'reset-password', { state: 'form' })
		);

		scope.post<{
			Params: { token: string };
			Body: { password?: string; repeat?: string };
		}>(
			'/reset-password/:token',
			{
				schema: {
					hide: true,
					params: { type: 'object', properties: { token: TOKEN } },
				},
			},
			async (request, reply) => {
				const { password = '', repeat = '' } = request.body ?? {};
				const show = (state: ResetState) =>
					render(request, reply, 'reset-password', { state });

				// Two inputs of the same person, not a comparison with a secret.
				// eslint-disable-next-line security/detect-possible-timing-attacks
				if (password !== repeat) return show('mismatch');
				try {
					await auth.api.resetPassword({
						body: {
							newPassword: password,
							token: request.params.token,
						},
					});
					return show('done');
				} catch (error) {
					if (!(error instanceof APIError)) throw error;
					const code = (error.body as { code?: string } | undefined)
						?.code;
					return show(
						code === 'PASSWORD_TOO_SHORT' ||
							code === 'PASSWORD_TOO_LONG'
							? 'length'
							: 'invalid'
					);
				}
			}
		);

		scope.get<{ Params: { id: string } }>(
			'/organization/acceptinvite/:id',
			{
				schema: {
					hide: true,
					params: { type: 'object', properties: { id: TOKEN } },
				},
			},
			(request, reply) =>
				render(request, reply, 'invitation', {
					id: request.params.id,
					link: `${(PUBLIC_URL ?? '').replace(/\/+$/, '')}/organization/acceptinvite/${request.params.id}`,
				})
		);
	});
};
