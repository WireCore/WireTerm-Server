import prisma from 'database';
import { ErrorCodes } from 'utils/ErrorCodes';
import { notFound, revision, toBase64 } from 'utils/http';
import { toApi as connectionToApi } from 'services/ConnectionService';
import { visibleProjectFilter, WorkspaceAccess } from 'services/AccessService';
import { workspaceKind } from 'services/WorkspaceService';

/// What has changed since `since` — including the tombstones, because a
/// deletion is a change like any other.
///
/// Three lists break the pattern and always come complete: this user's
/// project keys, the shares and the teams. They are a handful of rows per
/// workspace, and they have to be right as soon as they are needed — a key
/// that does not come along because `since` is too high makes a project
/// unreadable for no reason.
///
/// If this person's access has changed since `since` (`Member.accessRevision`),
/// the answer starts from zero: what became visible is older than `since`.
export async function delta(access: WorkspaceAccess, requested: bigint) {
	const organizationId = access.organizationId;
	const since = requested < access.accessRevision ? 0n : requested;

	const organization = await prisma.organization.findUnique({
		where: { id: organizationId },
		select: {
			id: true,
			name: true,
			slug: true,
			metadata: true,
			revision: true,
			memberProjects: true,
		},
	});
	if (!organization) throw notFound(ErrorCodes.WORKSPACE_NOT_FOUND);

	const visible = visibleProjectFilter(access);
	const projectScope = visible
		? { organizationId, id: visible }
		: { organizationId };

	const [
		projects,
		connections,
		secrets,
		vaults,
		knownHosts,
		snippets,
		keys,
		shares,
		teams,
	] = await Promise.all([
		prisma.project.findMany({
			where: { ...projectScope, revision: { gt: since } },
			orderBy: { position: 'asc' },
		}),
		prisma.connection.findMany({
			where: { revision: { gt: since }, project: projectScope },
			include: { ssh: true, ftp: true, s3: true },
			orderBy: { position: 'asc' },
		}),
		prisma.secret.findMany({
			where: {
				revision: { gt: since },
				connection: { project: projectScope },
			},
		}),
		prisma.vaultAccount.findMany({
			where: { organizationId, revision: { gt: since } },
		}),
		prisma.knownHostKey.findMany({
			where: { organizationId, revision: { gt: since } },
		}),
		prisma.snippet.findMany({
			where: { revision: { gt: since }, project: projectScope },
			orderBy: { position: 'asc' },
		}),
		// Oldest first: the last version per project is the current one, under
		// which the client puts new secrets. Without an order the old one
		// might come last after a rotation.
		prisma.projectKey.findMany({
			where: { userId: access.userId, project: projectScope },
			orderBy: { createdAt: 'asc' },
		}),
		prisma.projectShare.findMany({ where: { project: projectScope } }),
		// What a project can be shared with. In WireCloud mode only the teams
		// one of whose members has signed in here at least once.
		prisma.team.findMany({
			where: { organizationId },
			select: { id: true, name: true },
			orderBy: { name: 'asc' },
		}),
	]);

	return {
		workspace: {
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			kind: workspaceKind(organization.metadata),
			role: access.role,
			memberProjects: organization.memberProjects,
		},
		/// The value the client sets its `since` to. It comes from the same row
		/// that was filtered against above.
		revision: revision(organization.revision),
		projects: projects.map((project) => ({
			id: project.id,
			name: project.name,
			position: project.position,
			createdById: project.createdById,
			revision: revision(project.revision),
			deletedAt: project.deletedAt,
		})),
		connections: connections.map(connectionToApi),
		secrets: secrets.map(secretToApi),
		vaultAccounts: vaults.map((vault) => ({
			id: vault.id,
			provider: vault.provider,
			account: vault.account,
			server: vault.server,
			acceptInvalidCert: vault.acceptInvalidCert,
			revision: revision(vault.revision),
			deletedAt: vault.deletedAt,
		})),
		knownHosts: knownHosts.map((host) => ({
			id: host.id,
			host: host.host,
			port: host.port,
			algorithm: host.algorithm,
			publicKey: host.publicKey,
			trustedById: host.trustedById,
			revision: revision(host.revision),
			deletedAt: host.deletedAt,
		})),
		snippets: snippets.map(snippetToApi),
		projectKeys: keys.map(projectKeyToApi),
		shares: shares.map((share) => ({
			id: share.id,
			projectId: share.projectId,
			teamId: share.teamId,
			role: share.role,
		})),
		teams,
	};
}

export function secretToApi(secret: {
	connectionId: string;
	algorithm: string;
	keyId: string;
	nonce: Uint8Array;
	ciphertext: Uint8Array;
	revision: bigint;
	deletedAt: Date | null;
}) {
	return {
		connectionId: secret.connectionId,
		algorithm: secret.algorithm,
		keyId: secret.keyId,
		nonce: toBase64(secret.nonce),
		ciphertext: toBase64(secret.ciphertext),
		revision: revision(secret.revision),
		deletedAt: secret.deletedAt,
	};
}

export function projectKeyToApi(key: {
	projectId: string;
	userId: string;
	keyId: string;
	algorithm: string;
	ephemeralPublicKey: Uint8Array;
	nonce: Uint8Array;
	wrappedKey: Uint8Array;
}) {
	return {
		projectId: key.projectId,
		userId: key.userId,
		keyId: key.keyId,
		algorithm: key.algorithm,
		ephemeralPublicKey: toBase64(key.ephemeralPublicKey),
		nonce: toBase64(key.nonce),
		wrappedKey: toBase64(key.wrappedKey),
	};
}

export function snippetToApi(snippet: {
	id: string;
	projectId: string;
	connectionId: string | null;
	locked: boolean;
	name: string;
	folder: string;
	command: string;
	position: number;
	revision: bigint;
	deletedAt: Date | null;
}) {
	return {
		id: snippet.id,
		projectId: snippet.projectId,
		connectionId: snippet.connectionId,
		locked: snippet.locked,
		name: snippet.name,
		folder: snippet.folder,
		command: snippet.command,
		position: snippet.position,
		revision: revision(snippet.revision),
		deletedAt: snippet.deletedAt,
	};
}
