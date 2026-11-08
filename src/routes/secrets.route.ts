import { FastifyInstance } from 'fastify';
import prisma from 'database';
import { requireProject } from 'services/AccessService';
import { requireWorkspace } from 'services/RequestAccess';
import { nextRevision } from 'services/RevisionService';
import { checkRevision, loadConnection } from 'services/TreeService';
import { secretToApi } from 'services/SyncService';
import { ErrorCodes } from 'utils/ErrorCodes';
import { fromBase64, invalid, notFound } from 'utils/http';

type SecretParams = { organizationId: string; connectionId: string };

const putSchema = {
	body: {
		type: 'object',
		required: ['keyId', 'nonce', 'ciphertext'],
		additionalProperties: false,
		properties: {
			algorithm: { type: 'string', maxLength: 64 },
			keyId: { type: 'string', minLength: 1, maxLength: 64 },
			nonce: { type: 'string', maxLength: 64 },
			ciphertext: { type: 'string', maxLength: 131072 },
			expectedRevision: { type: 'string', pattern: '^\\d{1,19}$' },
		},
	},
};

/// A connection's ciphertext — the private key from `inlineKey`, the password
/// from `password`, the Secret Access Key from `secret`.
///
/// The server checks exactly two things about it: that the sender may edit
/// the project, and that `keyId` names a version of the project key that
/// exists. What is in the bytes it does not see — and cannot, since it has
/// never seen the key for them.
export default (fastify: FastifyInstance) => {
	fastify.put<{
		Params: SecretParams;
		Body: {
			algorithm?: string;
			keyId: string;
			nonce: string;
			ciphertext: string;
			expectedRevision?: string;
		};
	}>(
		'/api/workspaces/:organizationId/connections/:connectionId/secret',
		{ schema: putSchema },
		async (request) => {
			const { organizationId, connectionId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			const connection = await loadConnection(
				organizationId,
				connectionId
			);
			requireProject(access, connection.projectId, 'editor');

			const nonce = fromBase64(request.body.nonce, 'nonce', 32);
			const ciphertext = fromBase64(
				request.body.ciphertext,
				'ciphertext',
				65536
			);

			// A keyId nobody can open would be a silent promise of data loss.
			// So check whether the version was handed out to anyone at all.
			const known = await prisma.projectKey.findFirst({
				where: {
					projectId: connection.projectId,
					keyId: request.body.keyId,
				},
				select: { id: true },
			});
			if (!known) throw invalid('keyId is unknown for this project');

			const existing = await prisma.secret.findUnique({
				where: { connectionId },
			});
			if (existing) {
				checkRevision(existing.revision, request.body.expectedRevision);
			}

			const data = {
				algorithm: request.body.algorithm ?? 'xchacha20poly1305',
				keyId: request.body.keyId,
				nonce,
				ciphertext,
				deletedAt: null,
			};

			const secret = await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				return tx.secret.upsert({
					where: { connectionId },
					create: { connectionId, ...data, revision: next },
					update: { ...data, revision: next },
				});
			});

			return secretToApi(secret);
		}
	);

	fastify.delete<{ Params: SecretParams }>(
		'/api/workspaces/:organizationId/connections/:connectionId/secret',
		async (request, reply) => {
			const { organizationId, connectionId } = request.params;
			const access = await requireWorkspace(request, organizationId);
			const connection = await loadConnection(
				organizationId,
				connectionId
			);
			requireProject(access, connection.projectId, 'editor');

			const existing = await prisma.secret.findUnique({
				where: { connectionId },
			});
			if (!existing || existing.deletedAt) {
				throw notFound(ErrorCodes.SECRET_NOT_FOUND);
			}

			await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				await tx.secret.update({
					where: { connectionId },
					// The bytes go too. A tombstone tells the client that the
					// secret no longer exists — it does not have to keep the
					// secret for that.
					data: {
						deletedAt: new Date(),
						revision: next,
						nonce: new Uint8Array(0),
						ciphertext: new Uint8Array(0),
					},
				});
			});

			return reply.status(204).send();
		}
	);
};
