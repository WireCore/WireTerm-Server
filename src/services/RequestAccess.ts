import { FastifyRequest } from 'fastify';
import prisma from 'database';
import { requireUser } from 'services/AuthService';
import { WorkspaceAccess, workspaceAccess } from 'services/AccessService';

/// The two steps every route of this backend starts with: who is this, and
/// what may they do in this workspace.
export async function requireWorkspace(
	request: FastifyRequest,
	organizationId: string
): Promise<WorkspaceAccess> {
	const userId = await requireUser(request);
	return workspaceAccess(prisma, userId, organizationId);
}
