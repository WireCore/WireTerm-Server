import { FastifyInstance } from 'fastify';
import prisma from 'database';
import { requireWorkspaceAdmin } from 'services/AccessService';
import { requireWorkspace } from 'services/RequestAccess';
import { nextRevision } from 'services/RevisionService';
import { snippetToApi } from 'services/SyncService';
import { checkRevision } from 'services/TreeService';
import { ErrorCodes } from 'utils/ErrorCodes';
import { clientId, conflict, notFound } from 'utils/http';

type OrgParams = { organizationId: string };
type SnippetParams = OrgParams & { snippetId: string };

type SnippetBody = {
	name?: string;
	folder?: string;
	command?: string;
	position?: number;
	expectedRevision?: string;
};

const fields = {
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
		where: { id: snippetId, organizationId },
	});
	if (!snippet || snippet.deletedAt) {
		throw notFound(ErrorCodes.SNIPPET_NOT_FOUND);
	}
	return snippet;
}

/// A workspace's snippets.
///
/// Every member may read them — they come with the sync. Only owner and admin
/// may write: an SSH connection can name a snippet as its startup command, and
/// that then runs unasked in the terminal of every colleague who opens it.
export default (fastify: FastifyInstance) => {
	fastify.post<{ Params: OrgParams; Body: SnippetBody & { id: string } }>(
		'/api/workspaces/:organizationId/snippets',
		{ schema: createSchema },
		async (request, reply) => {
			const { organizationId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireWorkspaceAdmin(access);

			const existing = await prisma.snippet.findUnique({
				where: { id: request.body.id },
			});
			if (existing) throw conflict(ErrorCodes.SNIPPET_EXISTS);

			const snippet = await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				return tx.snippet.create({
					data: {
						id: request.body.id,
						organizationId,
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
			requireWorkspaceAdmin(access);

			const current = await loadSnippet(organizationId, snippetId);
			checkRevision(current.revision, request.body.expectedRevision);

			const { name, folder, command, position } = request.body;
			const snippet = await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				return tx.snippet.update({
					where: { id: snippetId },
					data: {
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
	/// deletion would otherwise never learn of it.
	fastify.delete<{ Params: SnippetParams }>(
		'/api/workspaces/:organizationId/snippets/:snippetId',
		async (request, reply) => {
			const { organizationId, snippetId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireWorkspaceAdmin(access);
			await loadSnippet(organizationId, snippetId);

			await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				await tx.snippet.update({
					where: { id: snippetId },
					data: { deletedAt: new Date(), revision: next },
				});
			});

			return reply.status(204).send();
		}
	);
};
