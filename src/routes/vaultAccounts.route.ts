import { FastifyInstance } from 'fastify';
import prisma from 'database';
import { VaultProvider } from 'generated/prisma/enums';
import { requireWorkspaceAdmin } from 'services/AccessService';
import { requireWorkspace } from 'services/RequestAccess';
import { nextRevision } from 'services/RevisionService';
import { invalid, revision } from 'utils/http';

type VaultParams = { organizationId: string; provider: VaultProvider };

const putSchema = {
	body: {
		type: 'object',
		additionalProperties: false,
		properties: {
			// 1Password: the account name. Bitwarden: the email address. The
			// vault's master password is no more stored here than in the client.
			account: { type: 'string', maxLength: 255 },
			server: { type: 'string', maxLength: 255 },
			acceptInvalidCert: { type: 'boolean' },
		},
	},
};

const PROVIDERS: VaultProvider[] = ['onePassword', 'bitwarden'];

/// Which vault account resolves the connections' references.
/// A workspace setting, so owner and admin.
export default (fastify: FastifyInstance) => {
	fastify.put<{
		Params: VaultParams;
		Body: {
			account?: string;
			server?: string;
			acceptInvalidCert?: boolean;
		};
	}>(
		'/api/workspaces/:organizationId/vault-accounts/:provider',
		{ schema: putSchema },
		async (request) => {
			const { organizationId, provider } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireWorkspaceAdmin(access);
			if (!PROVIDERS.includes(provider)) throw invalid('provider');

			const data = {
				account: request.body.account ?? '',
				server: request.body.server ?? '',
				acceptInvalidCert: request.body.acceptInvalidCert ?? false,
				deletedAt: null,
			};

			const vault = await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				return tx.vaultAccount.upsert({
					where: {
						organizationId_provider: { organizationId, provider },
					},
					create: {
						organizationId,
						provider,
						...data,
						revision: next,
					},
					update: { ...data, revision: next },
				});
			});

			return {
				id: vault.id,
				provider: vault.provider,
				account: vault.account,
				server: vault.server,
				acceptInvalidCert: vault.acceptInvalidCert,
				revision: revision(vault.revision),
			};
		}
	);

	fastify.delete<{ Params: VaultParams }>(
		'/api/workspaces/:organizationId/vault-accounts/:provider',
		async (request, reply) => {
			const { organizationId, provider } = request.params;
			const access = await requireWorkspace(request, organizationId);
			requireWorkspaceAdmin(access);
			if (!PROVIDERS.includes(provider)) throw invalid('provider');

			await prisma.$transaction(async (tx) => {
				const next = await nextRevision(tx, organizationId);
				await tx.vaultAccount.updateMany({
					where: { organizationId, provider, deletedAt: null },
					data: { deletedAt: new Date(), revision: next },
				});
			});

			return reply.status(204).send();
		}
	);
};
