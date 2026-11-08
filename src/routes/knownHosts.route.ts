import { FastifyInstance } from 'fastify';
import prisma from 'database';
import { requireWorkspace } from 'services/RequestAccess';
import { nextRevision } from 'services/RevisionService';
import { ErrorCodes } from 'utils/ErrorCodes';
import { invalid, notFound, revision } from 'utils/http';

type OrgParams = { organizationId: string };

/// A TLS certificate (FTPS, S3) sits in the same table as the host keys: with
/// this type and its SHA-256 fingerprint as hex in place of the key. One
/// certificate per host and port, the way a server presents one.
const CERTIFICATE = 'x509-sha256';

const postSchema = {
	body: {
		type: 'object',
		required: ['host', 'algorithm', 'publicKey'],
		additionalProperties: false,
		properties: {
			host: { type: 'string', minLength: 1, maxLength: 255 },
			port: { type: 'integer', minimum: 1, maximum: 65535 },
			algorithm: { type: 'string', minLength: 1, maxLength: 64 },
			publicKey: { type: 'string', minLength: 1, maxLength: 8192 },
		},
	},
};

/// The trusted host keys — today a `known_hosts` file per device.
///
/// On the workspace instead of the user, so that not every team member answers
/// the same question individually. Any member may add and remove them: whoever
/// finds a wrong entry should get rid of it without hunting for an
/// administrator. Whatever is trusted that way has been confirmed by a human
/// in the client anyway.
///
/// Only what the clients would otherwise silently pass over is checked: a
/// certificate whose fingerprint is not one.
export default (fastify: FastifyInstance) => {
	fastify.post<{
		Params: OrgParams;
		Body: {
			host: string;
			port?: number;
			algorithm: string;
			publicKey: string;
		};
	}>(
		'/api/workspaces/:organizationId/known-hosts',
		{ schema: postSchema },
		async (request, reply) => {
			const { organizationId } = request.params;
			if (
				request.body.algorithm === CERTIFICATE &&
				!/^[0-9a-f]{64}$/.test(request.body.publicKey)
			) {
				throw invalid(
					'publicKey: for x509-sha256 the SHA-256 fingerprint as 64 lowercase hex characters'
				);
			}
			const access = await requireWorkspace(request, organizationId);

			const port = request.body.port ?? 22;
			const data = {
				publicKey: request.body.publicKey,
				trustedById: access.userId,
				deletedAt: null,
			};

			const host = await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				return tx.knownHostKey.upsert({
					where: {
						organizationId_host_port_algorithm: {
							organizationId,
							host: request.body.host,
							port,
							algorithm: request.body.algorithm,
						},
					},
					create: {
						organizationId,
						host: request.body.host,
						port,
						algorithm: request.body.algorithm,
						...data,
						revision: next,
					},
					update: { ...data, revision: next },
				});
			});

			return reply.status(201).send({
				id: host.id,
				host: host.host,
				port: host.port,
				algorithm: host.algorithm,
				publicKey: host.publicKey,
				revision: revision(host.revision),
			});
		}
	);

	fastify.delete<{ Params: OrgParams & { id: string } }>(
		'/api/workspaces/:organizationId/known-hosts/:id',
		async (request, reply) => {
			const { organizationId, id } = request.params;
			await requireWorkspace(request, organizationId);

			const existing = await prisma.knownHostKey.findFirst({
				where: { id, organizationId },
			});
			if (!existing || existing.deletedAt) {
				throw notFound(ErrorCodes.KNOWN_HOST_NOT_FOUND);
			}

			await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				await tx.knownHostKey.update({
					where: { id },
					data: { deletedAt: new Date(), revision: next },
				});
			});

			return reply.status(204).send();
		}
	);
};
