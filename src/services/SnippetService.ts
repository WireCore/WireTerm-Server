import type { Prisma } from 'generated/prisma/client';
import prisma from 'database';

/// Whether a snippet may be this connection's startup command: a locked one,
/// and one that applies to the connection — for all connections of its
/// project, or for exactly this one. A snippet for this connection follows
/// it into another project, which is why the project only counts for the
/// others.
export async function startupSnippetFits(
	projectId: string,
	connectionId: string,
	snippetId: string
): Promise<boolean> {
	const snippet = await prisma.snippet.findFirst({
		where: { id: snippetId, deletedAt: null },
		select: { projectId: true, connectionId: true, locked: true },
	});
	if (!snippet?.locked) return false;
	if (snippet.connectionId) return snippet.connectionId === connectionId;
	return snippet.projectId === projectId;
}

/// Takes the startup command out of the connections that send one of these
/// snippets, and gives them the new revision so that every client learns of
/// it.
export async function dropStartupCommands(
	tx: Prisma.TransactionClient,
	snippetIds: string[],
	revision: bigint
) {
	if (snippetIds.length === 0) return;
	const users = await tx.sshConnection.findMany({
		where: { startupSnippetId: { in: snippetIds } },
		select: { connectionId: true },
	});
	if (users.length === 0) return;
	const connectionIds = users.map((user) => user.connectionId);
	await tx.sshConnection.updateMany({
		where: { connectionId: { in: connectionIds } },
		data: { startupSnippetId: null },
	});
	await tx.connection.updateMany({
		where: { id: { in: connectionIds } },
		data: { revision },
	});
}

/// Tombstones for the snippets that go with a deleted connection or project.
export async function tombstoneSnippets(
	tx: Prisma.TransactionClient,
	where: Prisma.SnippetWhereInput,
	deletedAt: Date,
	revision: bigint
) {
	await tx.snippet.updateMany({
		where: { ...where, deletedAt: null },
		data: { deletedAt, revision },
	});
}
