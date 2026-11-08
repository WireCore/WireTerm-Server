import prisma from 'database';
import { ErrorCodes } from 'utils/ErrorCodes';
import { conflict, invalid, notFound } from 'utils/http';

/// Optimistic locking. The client sends the revision it had in front of it
/// while editing; if it no longer matches, another device has written in the
/// meantime, and the answer is 409 instead of a silent overwrite.
///
/// Optional: whoever leaves out `expectedRevision` gets the old behavior, in
/// which the last writer wins.
export function checkRevision(current: bigint, expected: unknown) {
	if (expected === undefined || expected === null) return;
	const text =
		typeof expected === 'string' ||
		typeof expected === 'number' ||
		typeof expected === 'bigint'
			? String(expected)
			: '';
	if (!/^\d{1,19}$/.test(text)) throw invalid('expectedRevision');
	if (BigInt(text) !== current) {
		throw conflict(
			ErrorCodes.REVISION_CONFLICT,
			`expected ${text}, current ${current}`
		);
	}
}

export async function loadProject(organizationId: string, projectId: string) {
	const project = await prisma.project.findFirst({
		where: { id: projectId, organizationId },
	});
	if (!project || project.deletedAt) {
		throw notFound(ErrorCodes.PROJECT_NOT_FOUND);
	}
	return project;
}

export async function loadConnection(
	organizationId: string,
	connectionId: string
) {
	const connection = await prisma.connection.findFirst({
		where: { id: connectionId, project: { organizationId } },
		include: { ssh: true, ftp: true, s3: true },
	});
	if (!connection || connection.deletedAt) {
		throw notFound(ErrorCodes.CONNECTION_NOT_FOUND);
	}
	return connection;
}
