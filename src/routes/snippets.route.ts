import { FastifyInstance } from 'fastify';
import prisma from 'database';
import { isWorkspaceAdmin, requireProject } from 'services/AccessService';
import { requireWorkspace } from 'services/RequestAccess';
import { nextRevision } from 'services/RevisionService';
import { dropStartupCommands } from 'services/SnippetService';
import { snippetToApi } from 'services/SyncService';
import { checkRevision, loadProject } from 'services/TreeService';
import { ErrorCodes } from 'utils/ErrorCodes';
import { clientId, conflict, forbidden, invalid, notFound } from 'utils/http';

type OrgParams = { organizationId: string };
type ProjectParams = OrgParams & { projectId: string };
type SnippetParams = OrgParams & { snippetId: string };

type SnippetBody = {
	connectionId?: string | null;
	locked?: boolean;
	name?: string;
	folder?: string;
	command?: string;
	position?: number;
	expectedRevision?: string;
};

const fields = {
	connectionId: { type: ['string', 'null'], minLength: 1, maxLength: 191 },
	locked: { type: 'boolean' },
	name: { type: 'string', minLength: 1, maxLength: 255 },
	folder: { type: 'string', maxLength: 255 },
	command: { type: 'string', minLength: 1, maxLength: 65535 },
	position: { type: 'integer', minimum: 0 },
};

const createSchema = {
	body: {
		type: 'object',
		required: ['id', 'name', 'command'],
		additionalProperties: false,
		properties: { id: clientId, ...fields },
	},
};

const updateSchema = {
	body: {
		type: 'object',
		additionalProperties: false,
		properties: {
			...fields,
			expectedRevision: { type: 'string', pattern: '^\\d{1,19}$' },
		},
	},
};

async function loadSnippet(organizationId: string, snippetId: string) {
	const snippet = await prisma.snippet.findFirst({
		where: { id: snippetId, project: { organizationId } },
	});
	if (!snippet || snippet.deletedAt) {
		throw notFound(ErrorCodes.SNIPPET_NOT_FOUND);
	}
	return snippet;
}

/// A snippet for a single connection: it has to be one of the same project.
async function requireConnectionOf(projectId: string, connectionId: string) {
	const connection = await prisma.connection.findFirst({
		where: { id: connectionId, projectId, deletedAt: null },
		select: { id: true },
	});
	if (!connection) throw invalid('connectionId is not in this project');
}

/// How many live SSH connections send this snippet as their startup command —
/// with `except`, not counting that one.
function startupUsers(snippetId: string, except?: string) {
	return prisma.sshConnection.count({
		where: {
			startupSnippetId: snippetId,
			connection: { deletedAt: null },
			...(except ? { connectionId: { not: except } } : {}),
		},
	});
}

/// A project's snippets.
///
/// Whoever sees the project sees its snippets — they come with the sync.
/// Writing needs edit rights on the project, and for a locked snippet owner
/// or admin as well: only those lock and unlock, and only a locked snippet
/// can be a startup command, because that runs unasked in the terminal of
/// every colleague who opens the connection.
export default (fastify: FastifyInstance) => {
	fastify.post<{
		Params: ProjectParams;
		Body: SnippetBody & { id: string };
	}>(
		'/api/workspaces/:organizationId/projects/:projectId/snippets',
		{ schema: createSchema },
		async (request, reply) => {
			const { organizationId, projectId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireProject(access, projectId, 'editor');
			await loadProject(organizationId, projectId);

			const admin = isWorkspaceAdmin(access);
			// What an editor creates stays open to the other editors; owner
			// and admin lock theirs unless they say otherwise.
			const locked = request.body.locked ?? admin;
			if (locked && !admin) throw forbidden();

			const connectionId = request.body.connectionId ?? null;
			if (connectionId)
				await requireConnectionOf(projectId, connectionId);

			const existing = await prisma.snippet.findUnique({
				where: { id: request.body.id },
			});
			if (existing) throw conflict(ErrorCodes.SNIPPET_EXISTS);

			const snippet = await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				return tx.snippet.create({
					data: {
						id: request.body.id,
						projectId,
						connectionId,
						locked,
						name: request.body.name!,
						folder: request.body.folder ?? '',
						command: request.body.command!,
						position: request.body.position ?? 0,
						revision: next,
					},
				});
			});

			return reply.status(201).send(snippetToApi(snippet));
		}
	);

	fastify.patch<{ Params: SnippetParams; Body: SnippetBody }>(
		'/api/workspaces/:organizationId/snippets/:snippetId',
		{ schema: updateSchema },
		async (request) => {
			const { organizationId, snippetId } = request.params;
			const access = await requireWorkspace(request, organizationId);

			const current = await loadSnippet(organizationId, snippetId);
			requireProject(access, current.projectId, 'editor');
			const admin = isWorkspaceAdmin(access);
			const { connectionId, locked, name, folder, command, position } =
				request.body;
			if (current.locked && !admin) throw forbidden();
			if (locked !== undefined && locked !== current.locked && !admin) {
				throw forbidden();
			}
			checkRevision(current.revision, request.body.expectedRevision);

			// A startup command has to stay locked …
			if (locked === false && current.locked) {
				if ((await startupUsers(snippetId)) > 0) {
					throw conflict(ErrorCodes.SNIPPET_IN_USE);
				}
			}
			// … and has to keep applying to the connections that send it.
			// For all connections of the project it applies everywhere anyway.
			const retargeting =
				connectionId !== undefined &&
				connectionId !== current.connectionId;
			if (retargeting && connectionId) {
				await requireConnectionOf(current.projectId, connectionId);
				if ((await startupUsers(snippetId, connectionId)) > 0) {
					throw conflict(ErrorCodes.SNIPPET_IN_USE);
				}
			}

			const snippet = await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				return tx.snippet.update({
					where: { id: snippetId },
					data: {
						...(retargeting ? { connectionId } : {}),
						...(locked !== undefined ? { locked } : {}),
						...(name !== undefined ? { name } : {}),
						...(folder !== undefined ? { folder } : {}),
						...(command !== undefined ? { command } : {}),
						...(position !== undefined ? { position } : {}),
						revision: next,
					},
				});
			});

			return snippetToApi(snippet);
		}
	);

	/// A tombstone, as with projects: a device that has been offline since the
	/// deletion would otherwise never learn of it. Connections that sent it as
	/// their startup command lose it in the same step.
	fastify.delete<{ Params: SnippetParams }>(
		'/api/workspaces/:organizationId/snippets/:snippetId',
		async (request, reply) => {
			const { organizationId, snippetId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			const current = await loadSnippet(organizationId, snippetId);
			requireProject(access, current.projectId, 'editor');
			if (current.locked && !isWorkspaceAdmin(access)) throw forbidden();

			await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				await dropStartupCommands(tx, [snippetId], next);
				await tx.snippet.update({
					where: { id: snippetId },
					data: { deletedAt: new Date(), revision: next },
				});
			});

			return reply.status(204).send();
		}
	);
};
