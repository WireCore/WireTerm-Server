import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization, openAPI, multiSession } from 'better-auth/plugins';
import { apiKey } from '@better-auth/api-key';
import app from 'index';
import prisma from 'database';
import { sendTemplatedMail } from 'lib/mails';
import { localeFromAcceptLanguage, resolveLocale, toLocale } from 'lib/locale';
import {
	ensurePersonalWorkspace,
	workspaceKind,
} from 'services/WorkspaceService';
import {
	APP_LINK_BASE,
	BETTER_AUTH_COOKIE_DOMAIN,
	BETTER_AUTH_SECRET,
	PUBLIC_URL,
	COOKIE_SECRET,
	BETTER_AUTH_DISABLE_ORIGIN_CHECK,
	BETTER_AUTH_DISABLE_SIGNUP,
	BETTER_AUTH_TRUSTED_ORIGINS,
	CORS_ORIGIN,
} from 'globals';

/// Where the links in mails point: this backend's own pages
/// (`routes/pages.route.ts`), or a web frontend of one's own if APP_LINK_BASE
/// names one.
const linkBase = (APP_LINK_BASE || PUBLIC_URL || '').replace(/\/+$/, '');

/// Aborts startup in local mode without what sign-in and mails cannot work
/// without — better than failing on the first request or sending dead links.
export function assertLocalConfig() {
	const required: [string, string | undefined][] = [
		['PUBLIC_URL', PUBLIC_URL],
		['BETTER_AUTH_SECRET', BETTER_AUTH_SECRET],
		['COOKIE_SECRET', COOKIE_SECRET],
	];
	for (const [name, value] of required) {
		if (!value) throw new Error(`${name} is missing (AUTH_MODE=local)`);
	}
}

/// better-auth appends `callbackURL=/` when nobody sends one, and redirects
/// there after the verification — to the root of this backend, where nothing
/// lives. Without it `verify-email` answers with `{"status":true}`.
function withoutRootCallback(url: string): string {
	const link = new URL(url);
	if (link.searchParams.get('callbackURL') === '/') {
		link.searchParams.delete('callbackURL');
	}
	return link.toString();
}

export const auth = betterAuth({
	// Given explicitly rather than left to better-auth's own reading of the
	// environment, so that the secret can also come from a file (`_FILE`).
	secret: BETTER_AUTH_SECRET,
	baseURL: PUBLIC_URL,
	trustedOrigins: (BETTER_AUTH_TRUSTED_ORIGINS ?? CORS_ORIGIN ?? '')
		.split(',')
		.map((origin) => origin.trim())
		.filter(Boolean),
	// Three attempts per ten seconds for sign-in and sign-up, three per minute
	// for mails — the rules of better-auth. Enabled regardless of `NODE_ENV`,
	// so that an installation without it is not unthrottled.
	// `routes/auth.route.ts` sets the address from `request.ip` in
	// `X-Forwarded-For`; whatever the client sends there itself does not get
	// through. The counter lives in memory, so it applies per process.
	rateLimit: { enabled: true },
	advanced: {
		disableOriginCheck: BETTER_AUTH_DISABLE_ORIGIN_CHECK === '1',
		// Without a domain the cookie belongs to this host only.
		crossSubDomainCookies: {
			enabled: Boolean(BETTER_AUTH_COOKIE_DOMAIN),
			domain: BETTER_AUTH_COOKIE_DOMAIN,
		},
	},
	database: prismaAdapter(prisma, {
		provider: 'mysql',
	}),
	user: {
		additionalFields: {
			// The language of this account's mails and of its personal
			// workspace's name. No default here: the hook below must see "not
			// given" to fall back to `Accept-Language`. The column has its own.
			locale: {
				type: 'string',
				required: false,
				input: true,
			},
		},
	},
	databaseHooks: {
		user: {
			create: {
				// Without an explicit language, the first supported one from
				// `Accept-Language`, then the default.
				before: async (user, context) => {
					const requested = toLocale(
						(user as { locale?: unknown }).locale
					);
					const fromHeader = localeFromAcceptLanguage(
						context?.request?.headers.get('accept-language')
					);
					return {
						data: {
							...user,
							locale: resolveLocale(requested ?? fromHeader),
						},
					};
				},
				// Whoever signs up has a workspace right away — without the
				// question "What is your organization called?", which is none
				// of a private user's business. See `WorkspaceService`.
				after: async (user) => {
					await ensurePersonalWorkspace(
						auth,
						user.id,
						resolveLocale((user as { locale?: unknown }).locale)
					);
				},
			},
			update: {
				// `update-user` takes `locale` from the client; only a
				// supported one is stored, anything else is dropped.
				before: async (data) => {
					if (!('locale' in data)) return { data };
					const { locale, ...rest } = data as { locale?: unknown };
					const valid = toLocale(locale);
					return { data: valid ? { ...rest, locale: valid } : rest };
				},
			},
		},
	},
	emailAndPassword: {
		enabled: true,
		disableSignUp: BETTER_AUTH_DISABLE_SIGNUP === '1',
		// Resets the *sign-in password*, not the master password. Whoever
		// loses their master password does not get at their secrets this
		// way — that is what the recovery codes are for, see
		// `src/routes/keys.route.ts`.
		sendResetPassword: async ({ user, token }) => {
			await sendTemplatedMail(
				'password-reset',
				user.email,
				resolveLocale((user as { locale?: unknown }).locale),
				{ resetlink: `${linkBase}/reset-password/${token}` }
			);
		},
	},
	// Without a verified address `list-user-invitations` returns nothing — a
	// check in the organization plugin that cannot be turned off. Signing in
	// still works unverified.
	//
	// The link points to this backend, not to `linkBase`: better-auth handles
	// the verification itself, the desktop client does not have to open
	// anything for it.
	emailVerification: {
		sendOnSignUp: true,
		sendVerificationEmail: async ({ user, url }, request) => {
			try {
				await sendTemplatedMail(
					'email-verification',
					user.email,
					resolveLocale((user as { locale?: unknown }).locale),
					{ verifylink: withoutRootCallback(url) }
				);
			} catch (error) {
				// On sign-up the mail goes out on the side. If it fails, the
				// account should still be created; it is then requested via
				// `send-verification-email`, and there the error comes
				// through.
				if (request && !request.url.includes('/sign-up/')) throw error;
				app.log.error(error, 'Verification mail not sent');
			}
		},
	},
	plugins: [
		openAPI(),
		apiKey([
			{
				configId: 'user-keys',
				defaultPrefix: 'user_',
				references: 'user',
				enableSessionForAPIKeys: true,
				enableMetadata: true,
				rateLimit: { enabled: false },
			},
		]),
		organization({
			// Organization = workspace, team = the unit a project is shared
			// with. Both come entirely from this plugin; there are no
			// endpoints of our own for them.
			//
			// `allowUserToCreateOrganization` and `organizationLimit` stay
			// unset: anyone may create any number of organizations, and
			// without a limit the plugin does not even count.
			// No default team: otherwise the plugin would create a team of the
			// same name for every organization, with only the creator in it.
			// For "everyone in the organization" there is the share with an
			// empty `teamId`; a team that later invitees do not join would
			// only look like that.
			teams: {
				enabled: true,
				defaultTeam: { enabled: false },
			},
			organizationHooks: {
				// The personal workspace cannot be deleted. Otherwise someone
				// would be left without any workspace after one click, and a
				// second one would never be created — the sign-up that creates
				// it is long over.
				beforeDeleteOrganization: async ({ organization: org }) => {
					if (workspaceKind(org.metadata) === 'personal') {
						throw new APIError('BAD_REQUEST', {
							message:
								'The personal workspace cannot be deleted.',
							code: 'PERSONAL_WORKSPACE_NOT_DELETABLE',
						});
					}
				},
			},
			// In the language of the invited account if there is one, else in
			// the language of the request that sent the invitation.
			async sendInvitationEmail(data, request) {
				const invitee = await prisma.user.findUnique({
					where: { email: data.email.toLowerCase() },
					select: { locale: true },
				});
				const locale = resolveLocale(
					invitee?.locale ??
						localeFromAcceptLanguage(
							request?.headers.get('accept-language')
						)
				);
				await sendTemplatedMail(
					'organisation-invitation',
					data.email,
					locale,
					{
						...data,
						invitationLink: `${linkBase}/organization/acceptinvite/${data.id}`,
					}
				);
			},
		}),
		multiSession(),
	],
});
