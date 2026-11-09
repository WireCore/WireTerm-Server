import { FastifyInstance } from 'fastify';
import prisma from 'database';
import { requireWorkspaceAdmin } from 'services/AccessService';
import { requireWorkspace } from 'services/RequestAccess';
import { nextRevision } from 'services/RevisionService';
import { tombstoneSnippets } from 'services/SnippetService';
import { checkRevision, loadProject } from 'services/TreeService';
import { ErrorCodes } from 'utils/ErrorCodes';
import { clientId, conflict, revision } from 'utils/http';

type OrgParams = { organizationId: string };
type ProjectParams = OrgParams & { projectId: string };

const createSchema = {
	body: {
		type: 'object',
		required: ['id', 'name'],
		additionalProperties: false,
		properties: {
			// The ID comes from the client: it also creates projects offline,
			// and renumbering on upload would drag every connection below it
			// along.
			id: clientId,
			name: { type: 'string', minLength: 1, maxLength: 255 },
			position: { type: 'integer', minimum: 0 },
		},
	},
};

const updateSchema = {
	body: {
		type: 'object',
		additionalProperties: false,
		properties: {
			name: { type: 'string', minLength: 1, maxLength: 255 },
			position: { type: 'integer', minimum: 0 },
			expectedRevision: { type: 'string', pattern: '^\\d{1,19}$' },
		},
	},
};

export default (fastify: FastifyInstance) => {
	fastify.post<{
		Params: OrgParams;
		Body: { id: string; name: string; position?: number };
	}>(
		'/api/workspaces/:organizationId/projects',
		{ schema: createSchema },
		async (request, reply) => {
			const { organizationId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireWorkspaceAdmin(access);

			const existing = await prisma.project.findUnique({
				where: { id: request.body.id },
			});
			if (existing) throw conflict(ErrorCodes.PROJECT_EXISTS);

			const project = await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				return tx.project.create({
					data: {
						id: request.body.id,
						organizationId,
						name: request.body.name,
						position: request.body.position ?? 0,
						createdById: access.userId,
						revision: next,
					},
				});
			});

			return reply.status(201).send({
				id: project.id,
				name: project.name,
				position: project.position,
				revision: revision(project.revision),
			});
		}
	);

	fastify.patch<{
		Params: ProjectParams;
		Body: {
			name?: string;
			position?: number;
			expectedRevision?: string;
		};
	}>(
		'/api/workspaces/:organizationId/projects/:projectId',
		{ schema: updateSchema },
		async (request) => {
			const { organizationId, projectId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireWorkspaceAdmin(access);

			const current = await loadProject(organizationId, projectId);
			checkRevision(current.revision, request.body.expectedRevision);

			const project = await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				return tx.project.update({
					where: { id: projectId },
					data: {
						...(request.body.name !== undefined
							? { name: request.body.name }
							: {}),
						...(request.body.position !== undefined
							? { position: request.body.position }
							: {}),
						revision: next,
					},
				});
			});

			return {
				id: project.id,
				name: project.name,
				position: project.position,
				revision: revision(project.revision),
			};
		}
	);

	/// Deleting sets a tombstone instead of removing the row: a device that
	/// has been offline since the deletion would otherwise never learn of it.
	/// The connections and snippets below get their own, so the client removes
	/// them from its copy one by one.
	fastify.delete<{ Params: ProjectParams }>(
		'/api/workspaces/:organizationId/projects/:projectId',
		async (request, reply) => {
			const { organizationId, projectId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireWorkspaceAdmin(access);
			await loadProject(organizationId, projectId);

			await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				const deletedAt = new Date();

				await tx.connection.updateMany({
					where: { projectId, deletedAt: null },
					data: { deletedAt, revision: next },
				});
				await tx.secret.updateMany({
					where: {
						connection: { projectId },
						deletedAt: null,
					},
					data: {
						deletedAt,
						revision: next,
						nonce: new Uint8Array(0),
						ciphertext: new Uint8Array(0),
					},
				});
				await tombstoneSnippets(tx, { projectId }, deletedAt, next);
				await tx.project.update({
					where: { id: projectId },
					data: { deletedAt, revision: next },
				});
			});

			return reply.status(204).send();
		}
	);
};
