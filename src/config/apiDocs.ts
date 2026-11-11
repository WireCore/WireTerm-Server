import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { SwaggerOptions } from '@fastify/swagger';
import { PUBLIC_URL } from 'globals';

/// The API reference: the interactive one under /documentation (API_DOCS=true)
/// and the page published from `npm run openapi` both come from here.
///
/// Tag and summary of every route are kept in this one place rather than in
/// the route files; `test/config/apiDocs.test.ts` fails as soon as a route
/// that is not hidden has no entry, so the reference cannot silently fall
/// behind.

export const TAGS = [
	{
		name: 'Keys',
		description:
			"A user's key pair and recovery codes — always as ciphertext; the master password never reaches the server.",
	},
	{
		name: 'Workspaces',
		description: 'The workspaces of the signed-in user and their sync.',
	},
	{
		name: 'Projects',
		description: 'Projects inside a workspace and their snippets.',
	},
	{
		name: 'Connections',
		description:
			'SSH, FTP and S3 connections; their secret only as ciphertext.',
	},
	{
		name: 'Sharing',
		description:
			'Shares with teams and the wrapped project keys that open them.',
	},
	{
		name: 'Workspace settings',
		description: 'Vault accounts and trusted host keys.',
	},
];

type RouteDoc = { tags: string[]; summary: string };

const WS = '/api/workspaces/:organizationId';

export const ROUTE_DOCS: Record<string, RouteDoc> = {
	'GET /api/keys/me': {
		tags: ['Keys'],
		summary: 'Own key material, including the recovery codes',
	},
	'POST /api/keys/me': {
		tags: ['Keys'],
		summary: 'Set up the key pair (once; 409 if it exists)',
	},
	'POST /api/keys/me/rewrap': {
		tags: ['Keys'],
		summary:
			'New master password: rewrapped private key and a new set of codes',
	},
	'POST /api/keys/me/recovery/:id/used': {
		tags: ['Keys'],
		summary: 'Mark a recovery code as used',
	},

	'GET /api/workspaces': {
		tags: ['Workspaces'],
		summary:
			"The user's workspaces, with their kind, role and – in WireCloud mode – the WireCloud company",
	},
	[`GET ${WS}/sync`]: {
		tags: ['Workspaces'],
		summary: 'Everything that changed since a revision (`?since=N`)',
	},
	[`PATCH ${WS}`]: {
		tags: ['Workspaces'],
		summary:
			'Change the settings of a workspace (whether members may create projects)',
	},

	[`POST ${WS}/projects`]: {
		tags: ['Projects'],
		summary: 'Create a project',
	},
	[`PATCH ${WS}/projects/:projectId`]: {
		tags: ['Projects'],
		summary: 'Rename or reorder a project',
	},
	[`DELETE ${WS}/projects/:projectId`]: {
		tags: ['Projects'],
		summary: 'Delete a project (tombstone)',
	},

	[`POST ${WS}/projects/:projectId/connections`]: {
		tags: ['Connections'],
		summary: 'Create a connection',
	},
	[`PATCH ${WS}/connections/:connectionId`]: {
		tags: ['Connections'],
		summary: 'Change a connection or move it to another project',
	},
	[`DELETE ${WS}/connections/:connectionId`]: {
		tags: ['Connections'],
		summary: 'Delete a connection (tombstone)',
	},
	[`PUT ${WS}/connections/:connectionId/secret`]: {
		tags: ['Connections'],
		summary: "Set a connection's secret (ciphertext)",
	},
	[`DELETE ${WS}/connections/:connectionId/secret`]: {
		tags: ['Connections'],
		summary: "Remove a connection's secret",
	},

	[`GET ${WS}/projects/:projectId/shares`]: {
		tags: ['Sharing'],
		summary: 'Shares of a project',
	},
	[`PUT ${WS}/projects/:projectId/shares`]: {
		tags: ['Sharing'],
		summary: 'Replace the shares of a project',
	},
	[`GET ${WS}/member-keys`]: {
		tags: ['Sharing'],
		summary: 'Public keys of the members',
	},
	[`GET ${WS}/projects/:projectId/key-requests`]: {
		tags: ['Sharing'],
		summary: 'Who can see the project but still lacks its key',
	},
	[`POST ${WS}/projects/:projectId/keys`]: {
		tags: ['Sharing'],
		summary: 'Hand in project keys wrapped for other members',
	},
	[`DELETE ${WS}/projects/:projectId/keys/:userId`]: {
		tags: ['Sharing'],
		summary: "Revoke a member's copy of the project key",
	},
	[`GET ${WS}/members/:userId/stale-keys`]: {
		tags: ['Sharing'],
		summary: 'Project keys to renew after a member left',
	},

	[`PUT ${WS}/vault-accounts/:provider`]: {
		tags: ['Workspace settings'],
		summary: 'Set the 1Password or Bitwarden account of the workspace',
	},
	[`DELETE ${WS}/vault-accounts/:provider`]: {
		tags: ['Workspace settings'],
		summary: 'Remove the vault account',
	},
	[`POST ${WS}/known-hosts`]: {
		tags: ['Workspace settings'],
		summary: 'Trust a host key or TLS certificate',
	},
	[`DELETE ${WS}/known-hosts/:id`]: {
		tags: ['Workspace settings'],
		summary: 'Revoke trust in a host key',
	},
	[`POST ${WS}/projects/:projectId/snippets`]: {
		tags: ['Projects'],
		summary: 'Create a snippet (editor; locked only owner, admin)',
	},
	[`PATCH ${WS}/snippets/:snippetId`]: {
		tags: ['Projects'],
		summary: 'Change a snippet (a locked one only owner, admin)',
	},
	[`DELETE ${WS}/snippets/:snippetId`]: {
		tags: ['Projects'],
		summary: 'Delete a snippet (tombstone, drops it as startup command)',
	},
};

const DOCS = new Map(Object.entries(ROUTE_DOCS));

/// better-auth's catch-all route stands for its own endpoints, which come
/// into the reference from better-auth's description instead.
const HIDDEN = new Set(['GET /api/auth/*', 'POST /api/auth/*']);

export function routeKey(method: string, url: string): string {
	return `${method} ${url}`;
}

/// Puts tag and summary on every route as it is registered. Must be called
/// before the routes are added.
export function documentRoutes(app: FastifyInstance) {
	app.addHook('onRoute', (route) => {
		const methods = Array.isArray(route.method)
			? route.method
			: [route.method];
		const keys = methods.map((method) => routeKey(method, route.url));
		if (keys.every((key) => HIDDEN.has(key))) {
			route.schema = { ...route.schema, hide: true };
			return;
		}
		const doc = keys
			.map((key) => DOCS.get(key))
			.find((entry) => entry !== undefined);
		if (doc) route.schema = { ...doc, ...route.schema };
	});
}

type OpenApiDocument = {
	paths?: Record<string, unknown>;
	tags?: { name: string; description?: string }[];
	components?: Record<string, Record<string, unknown>>;
};

/// better-auth's tags, named like ours.
const AUTH_TAGS = new Map([
	['Default', 'Accounts'],
	['Organization', 'Organizations and teams'],
	['Api-key', 'API keys'],
	['Multi-session', 'Sessions'],
]);

function renameTags(item: unknown): unknown {
	if (!item || typeof item !== 'object') return item;
	return Object.fromEntries(
		Object.entries(item).map(([method, operation]) => {
			const tags = (operation as { tags?: string[] } | undefined)?.tags;
			return [
				method,
				tags
					? {
							...(operation as object),
							tags: tags.map((tag) => AUTH_TAGS.get(tag) ?? tag),
						}
					: operation,
			];
		})
	);
}

/// Adds better-auth's endpoints (sign-up, sign-in, organizations, teams, API
/// keys …) to the description, under `/api/auth`.
function withAuth(
	document: OpenApiDocument,
	authDocument: OpenApiDocument
): OpenApiDocument {
	const paths = {
		...document.paths,
		...Object.fromEntries(
			Object.entries(authDocument.paths ?? {}).map(([path, item]) => [
				`/api/auth${path}`,
				renameTags(item),
			])
		),
	};
	const own = new Map(Object.entries(document.components ?? {}));
	const merged: [string, Record<string, unknown>][] = [
		...own,
		...Object.entries(authDocument.components ?? {}).map(
			([kind, entries]): [string, Record<string, unknown>] => [
				kind,
				{ ...entries, ...own.get(kind) },
			]
		),
	];
	const components = Object.fromEntries(merged);
	const authTags = (authDocument.tags ?? []).map((tag) => ({
		...tag,
		name: AUTH_TAGS.get(tag.name) ?? tag.name,
		description:
			tag.name === 'Default'
				? 'Sign-up, sign-in, sessions and the account (better-auth)'
				: tag.description,
	}));
	return {
		...document,
		paths,
		components,
		tags: [...(document.tags ?? []), ...authTags],
	};
}

/// src/config and dist/config both sit two levels below package.json.
function packageVersion(): string {
	const file = new URL('../../package.json', import.meta.url);
	// A fixed path next to the code, not input.
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	return (JSON.parse(readFileSync(file, 'utf8')) as { version: string })
		.version;
}

export function swaggerOptions(authDocument?: unknown): SwaggerOptions {
	return {
		openapi: {
			openapi: '3.1.0',
			info: {
				title: 'WireTerm Server',
				description:
					'Synchronizes WireTerm workspaces between devices and people. Secrets pass through only as ciphertext. Errors come as `{ "code": "…", "detail": "…" }`.',
				version: packageVersion(),
			},
			tags: TAGS,
			// "Try it" in the reference goes to this server.
			servers: PUBLIC_URL ? [{ url: PUBLIC_URL }] : [],
		},
		transformObject: (documentObject) => {
			const document = (
				'openapiObject' in documentObject
					? documentObject.openapiObject
					: documentObject.swaggerObject
			) as OpenApiDocument;
			return (
				authDocument ? withAuth(document, authDocument) : document
			) as never;
		},
	};
}
