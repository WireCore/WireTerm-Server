import { FastifyInstance } from 'fastify';
import prisma from 'database';
import { requireProject } from 'services/AccessService';
import { requireWorkspace } from 'services/RequestAccess';
import { nextRevision } from 'services/RevisionService';
import { startupSnippetFits, tombstoneSnippets } from 'services/SnippetService';
import {
	checkRevision,
	loadConnection,
	loadProject,
} from 'services/TreeService';
import {
	ConnectionBody,
	ftpData,
	requireMatchingSettings,
	s3Data,
	settingsData,
	sshData,
	systemData,
	toApi,
} from 'services/ConnectionService';
import { ErrorCodes } from 'utils/ErrorCodes';
import { clientId, conflict } from 'utils/http';

type OrgParams = { organizationId: string };
type ProjectParams = OrgParams & { projectId: string };
type ConnectionParams = OrgParams & { connectionId: string };

const vaultProvider = { type: 'string', enum: ['onePassword', 'bitwarden'] };

/// Deviates from the device's default proxy — direct, or through a custom one.
/// No authentication: a connection has exactly one secret, and that is its own.
const proxy = {
	type: 'object',
	required: ['mode'],
	additionalProperties: false,
	properties: {
		mode: { type: 'string', enum: ['direct', 'custom'] },
		kind: { type: 'string', enum: ['socks5', 'http'] },
		host: { type: 'string', minLength: 1, maxLength: 255 },
		port: { type: 'integer', minimum: 1, maximum: 65535 },
	},
	if: { properties: { mode: { const: 'custom' } } },
	then: { required: ['kind', 'host', 'port'] },
};

const ssh = {
	type: 'object',
	required: ['host', 'user', 'authSource'],
	additionalProperties: false,
	properties: {
		host: { type: 'string', minLength: 1, maxLength: 255 },
		port: { type: 'integer', minimum: 1, maximum: 65535 },
		user: { type: 'string', minLength: 1, maxLength: 255 },
		authSource: {
			type: 'string',
			enum: [
				'inlineKey',
				'keyFile',
				'vault',
				'password',
				'vaultPassword',
				'prompt',
				'agent',
			],
		},
		keyFilePath: { type: 'string', maxLength: 1024 },
		vaultProvider,
		vaultReference: { type: 'string', maxLength: 1024 },
		startPath: { type: 'string', maxLength: 1024 },
		jumpConnectionId: { type: 'string', minLength: 1, maxLength: 191 },
		agentForwarding: { type: 'boolean' },
		startupSnippetId: { type: 'string', minLength: 1, maxLength: 191 },
		forwards: {
			type: 'array',
			maxItems: 32,
			items: {
				type: 'object',
				required: ['kind', 'bindPort'],
				additionalProperties: false,
				properties: {
					kind: {
						type: 'string',
						enum: ['local', 'remote', 'dynamic'],
					},
					bindHost: { type: 'string', maxLength: 255 },
					bindPort: { type: 'integer', minimum: 0, maximum: 65535 },
					targetHost: { type: 'string', maxLength: 255 },
					targetPort: { type: 'integer', minimum: 0, maximum: 65535 },
				},
			},
		},
		proxy,
	},
};

const ftp = {
	type: 'object',
	// `user` is missing for `anonymous`, so it is not required.
	required: ['host', 'authSource'],
	additionalProperties: false,
	properties: {
		host: { type: 'string', minLength: 1, maxLength: 255 },
		port: { type: 'integer', minimum: 1, maximum: 65535 },
		user: { type: 'string', maxLength: 255 },
		authSource: {
			type: 'string',
			enum: ['anonymous', 'password', 'vault', 'prompt'],
		},
		vaultProvider,
		vaultReference: { type: 'string', maxLength: 1024 },
		security: { type: 'string', enum: ['plain', 'explicit', 'implicit'] },
		passive: { type: 'boolean' },
		acceptInvalidCert: { type: 'boolean' },
		startPath: { type: 'string', maxLength: 1024 },
		proxy,
	},
};

const s3 = {
	type: 'object',
	required: ['host', 'user', 'authSource'],
	additionalProperties: false,
	properties: {
		host: { type: 'string', minLength: 1, maxLength: 255 },
		port: { type: 'integer', minimum: 1, maximum: 65535 },
		user: { type: 'string', minLength: 1, maxLength: 255 },
		authSource: { type: 'string', enum: ['secret', 'vault', 'prompt'] },
		vaultProvider,
		vaultReference: { type: 'string', maxLength: 1024 },
		region: { type: 'string', maxLength: 64 },
		bucket: { type: 'string', maxLength: 255 },
		prefix: { type: 'string', maxLength: 1024 },
		tls: { type: 'boolean' },
		pathStyle: { type: 'boolean' },
		acceptInvalidCert: { type: 'boolean' },
		storageClass: { type: 'string', maxLength: 64 },
		proxy,
	},
};

const system = {
	type: ['object', 'null'],
	required: ['id', 'name', 'version', 'pretty'],
	additionalProperties: false,
	properties: {
		id: { type: 'string', maxLength: 64 },
		name: { type: 'string', maxLength: 128 },
		version: { type: 'string', maxLength: 64 },
		pretty: { type: 'string', maxLength: 255 },
	},
};

const common = {
	name: { type: 'string', minLength: 1, maxLength: 255 },
	type: { type: 'string', enum: ['ssh', 'ftp', 's3'] },
	bookmarked: { type: 'boolean' },
	position: { type: 'integer', minimum: 0 },
	system,
	ssh,
	ftp,
	s3,
};

const createSchema = {
	body: {
		type: 'object',
		required: ['id', 'name', 'type'],
		additionalProperties: false,
		properties: {
			id: clientId,
			...common,
		},
	},
};

const updateSchema = {
	body: {
		type: 'object',
		additionalProperties: false,
		properties: {
			...common,
			// Move into another project of the same workspace.
			projectId: { type: 'string', minLength: 1, maxLength: 191 },
			expectedRevision: { type: 'string', pattern: '^\\d{1,19}$' },
		},
	},
};

export default (fastify: FastifyInstance) => {
	fastify.post<{
		Params: ProjectParams;
		Body: ConnectionBody & { id: string };
	}>(
		'/api/workspaces/:organizationId/projects/:projectId/connections',
		{ schema: createSchema },
		async (request, reply) => {
			const { organizationId, projectId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireProject(access, projectId, 'editor');
			await loadProject(organizationId, projectId);

			const type = requireMatchingSettings(request.body);

			const startup = request.body.ssh?.startupSnippetId as
				string | undefined;
			if (
				startup &&
				!(await startupSnippetFits(projectId, request.body.id, startup))
			) {
				throw conflict(ErrorCodes.SNIPPET_NOT_STARTUP);
			}

			const existing = await prisma.connection.findUnique({
				where: { id: request.body.id },
			});
			if (existing) throw conflict(ErrorCodes.CONNECTION_EXISTS);

			const connection = await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				return tx.connection.create({
					data: {
						id: request.body.id,
						projectId,
						name: request.body.name!,
						type,
						bookmarked: request.body.bookmarked ?? false,
						position: request.body.position ?? 0,
						revision: next,
						...systemData(request.body),
						...settingsData(type, request.body),
					},
					include: { ssh: true, ftp: true, s3: true },
				});
			});

			return reply.status(201).send(toApi(connection));
		}
	);

	/// The settings come as a whole or not at all: a half connection — new
	/// host, old authentication — does not exist in the client either, the
	/// form always sends the complete set.
	fastify.patch<{ Params: ConnectionParams; Body: ConnectionBody }>(
		'/api/workspaces/:organizationId/connections/:connectionId',
		{ schema: updateSchema },
		async (request) => {
			const { organizationId, connectionId } = request.params;
			const access = await requireWorkspace(request, organizationId);

			const current = await loadConnection(organizationId, connectionId);
			requireProject(access, current.projectId, 'editor');
			checkRevision(current.revision, request.body.expectedRevision);

			// Moving means: out of one project and into the other — so edit
			// rights on both. The secret moves along, but is still under the
			// old project's key; only the client can rewrap it.
			const target = request.body.projectId;
			const moving = target !== undefined && target !== current.projectId;
			if (moving) {
				requireProject(access, target, 'editor');
				await loadProject(organizationId, target);
			}

			const changesSettings =
				request.body.ssh !== undefined ||
				request.body.ftp !== undefined ||
				request.body.s3 !== undefined;
			const type = changesSettings
				? requireMatchingSettings({
						...request.body,
						type: request.body.type ?? current.type,
					})
				: current.type;

			// The startup command has to fit where the connection ends up. One
			// that was set before and stays behind in the old project is
			// dropped on a move instead of blocking it.
			const project = moving ? target : current.projectId;
			const before = current.ssh?.startupSnippetId ?? null;
			const sent =
				request.body.ssh === undefined
					? before
					: ((request.body.ssh.startupSnippetId as
							string | undefined) ?? null);
			let dropStartup = false;
			if (
				sent &&
				(sent !== before || moving) &&
				!(await startupSnippetFits(project, connectionId, sent))
			) {
				if (sent !== before) {
					throw conflict(ErrorCodes.SNIPPET_NOT_STARTUP);
				}
				dropStartup = true;
			}

			const connection = await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);

				if (changesSettings) {
					// A type change leaves the old settings row in place if
					// nobody removes it — and `toApi` would then return two.
					if (type !== 'ssh')
						await tx.sshConnection.deleteMany({
							where: { connectionId },
						});
					if (type !== 'ftp')
						await tx.ftpConnection.deleteMany({
							where: { connectionId },
						});
					if (type !== 's3')
						await tx.s3Connection.deleteMany({
							where: { connectionId },
						});

					if (type === 'ssh') {
						const data = sshData(request.body.ssh!);
						await tx.sshConnection.upsert({
							where: { connectionId },
							create: { connectionId, ...data },
							update: data,
						});
					} else if (type === 'ftp') {
						const data = ftpData(request.body.ftp!);
						await tx.ftpConnection.upsert({
							where: { connectionId },
							create: { connectionId, ...data },
							update: data,
						});
					} else {
						const data = s3Data(request.body.s3!);
						await tx.s3Connection.upsert({
							where: { connectionId },
							create: { connectionId, ...data },
							update: data,
						});
					}
				}

				if (dropStartup) {
					await tx.sshConnection.updateMany({
						where: { connectionId },
						data: { startupSnippetId: null },
					});
				}
				// Its own snippets go along into the other project.
				if (moving) {
					await tx.snippet.updateMany({
						where: { connectionId },
						data: { projectId: target, revision: next },
					});
				}

				return tx.connection.update({
					where: { id: connectionId },
					data: {
						...(request.body.name !== undefined
							? { name: request.body.name }
							: {}),
						...(request.body.bookmarked !== undefined
							? { bookmarked: request.body.bookmarked }
							: {}),
						...(request.body.position !== undefined
							? { position: request.body.position }
							: {}),
						...(moving ? { projectId: target } : {}),
						type,
						revision: next,
						...systemData(request.body),
					},
					include: { ssh: true, ftp: true, s3: true },
				});
			});

			return toApi(connection);
		}
	);

	fastify.delete<{ Params: ConnectionParams }>(
		'/api/workspaces/:organizationId/connections/:connectionId',
		async (request, reply) => {
			const { organizationId, connectionId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			const current = await loadConnection(organizationId, connectionId);
			requireProject(access, current.projectId, 'editor');

			await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				const deletedAt = new Date();
				await tx.secret.updateMany({
					where: { connectionId, deletedAt: null },
					data: {
						deletedAt,
						revision: next,
						nonce: new Uint8Array(0),
						ciphertext: new Uint8Array(0),
					},
				});
				await tombstoneSnippets(tx, { connectionId }, deletedAt, next);
				await tx.connection.update({
					where: { id: connectionId },
					data: { deletedAt, revision: next },
				});
			});

			return reply.status(204).send();
		}
	);
};
