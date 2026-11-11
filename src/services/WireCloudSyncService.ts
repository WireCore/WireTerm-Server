import { randomUUID } from 'node:crypto';
import type { PrismaClient } from 'generated/prisma/client';
import type { WireCloudClaims, WireCloudMembership } from 'lib/wirecloud';
import { markAccessChanged } from 'services/RevisionService';
import { ErrorCodes } from 'utils/ErrorCodes';
import { HttpError, conflict } from 'utils/http';

/// Syncs the claims of a verified WireCloud token with the stored state
/// (VERTRAG.md 8.2): user, company as organization, membership and teams are
/// created on the first call and brought in line afterwards.
///
/// The sync is **per user**: a person's token names their own teams, so it
/// only changes the rows of that one person. Every member syncs themselves on
/// their own call.
///
/// It goes exclusively by the token. A membership in a company managed by
/// WireCloud that the token does not name (any more) is removed:
/// `workspaceAccess` decides via `member`, and a leftover row would otherwise
/// grant access beyond the token.

/// WireTerm's roles. The sync rejects any other role in the token.
const ROLES: ReadonlySet<string> = new Set(['owner', 'admin', 'member']);

/// Marker in `organization.metadata`, not to be confused with `personal`
/// (see `WorkspaceService`).
export const COMPANY = 'company';

export type SyncDeps = {
	prisma: PrismaClient;
	/// Creates the account via better-auth, so that its hooks run.
	createUser: (input: {
		email: string;
		name: string;
		emailVerified: boolean;
	}) => Promise<{ id: string }>;
	/// Creates "Personal" if it is still missing (idempotent).
	ensurePersonalWorkspace: (userId: string) => Promise<void>;
	now?: () => Date;
};

type Db = Pick<
	PrismaClient,
	'user' | 'organization' | 'member' | 'team' | 'teamMember' | 'externalRef'
>;

async function refFor(
	db: Pick<Db, 'externalRef'>,
	entityType: string,
	issuer: string,
	externalId: string
) {
	return db.externalRef.findUnique({
		where: {
			entityType_issuer_externalId: { entityType, issuer, externalId },
		},
	});
}

async function ensureUser(deps: SyncDeps, claims: WireCloudClaims) {
	const { prisma } = deps;
	const { account } = claims;
	// better-auth stores addresses in lowercase; comparison does the same.
	const email = account.email.toLowerCase();

	const ref = await refFor(prisma, 'user', claims.issuer, claims.subject);
	if (ref) {
		const user = await prisma.user.findUnique({
			where: { id: ref.localId },
		});
		if (user) {
			const data: {
				name?: string;
				emailVerified?: boolean;
				email?: string;
			} = {};
			if (user.name !== account.name) data.name = account.name;
			if (user.emailVerified !== account.emailVerified) {
				data.emailVerified = account.emailVerified;
			}
			// A new address only applies if it does not belong to another account.
			if (user.email !== email) {
				const taken = await prisma.user.findUnique({
					where: { email },
					select: { id: true },
				});
				if (!taken) data.email = email;
			}
			if (Object.keys(data).length > 0) {
				await prisma.user.update({ where: { id: user.id }, data });
			}
			return user.id;
		}
		// The account no longer exists, the mapping is orphaned.
		await prisma.externalRef.delete({ where: { id: ref.id } });
	}

	// A new account gets an address that no local account has yet. An
	// existing account is **not** linked automatically: with a foreign issuer
	// the same address does not prove that it is the same person. Linking by
	// email with confirmation (D25) is a separate step and not part of this
	// sync.
	const existing = await prisma.user.findUnique({
		where: { email },
		select: { id: true },
	});
	if (existing) throw conflict(ErrorCodes.WIRECLOUD_EMAIL_CONFLICT);

	const created = await deps.createUser({
		email,
		name: account.name,
		emailVerified: account.emailVerified,
	});
	await prisma.externalRef.create({
		data: {
			entityType: 'user',
			localId: created.id,
			issuer: claims.issuer,
			externalId: claims.subject,
		},
	});
	// Thanks to better-auth's hook "Personal" is usually already there; this is
	// the safeguard and then does nothing.
	await deps.ensurePersonalWorkspace(created.id);
	return created.id;
}

async function ensureOrganization(
	db: Db,
	issuer: string,
	membership: WireCloudMembership,
	now: Date
): Promise<string> {
	const ref = await refFor(db, 'organization', issuer, membership.company);
	if (ref) {
		const org = await db.organization.findUnique({
			where: { id: ref.localId },
		});
		if (org) {
			if (org.name !== membership.name) {
				await db.organization.update({
					where: { id: org.id },
					data: { name: membership.name },
				});
			}
			return org.id;
		}
		await db.externalRef.delete({ where: { id: ref.id } });
	}

	let slug = `company-${membership.company.toLowerCase()}`;
	if (await db.organization.findUnique({ where: { slug } })) {
		slug = `${slug}-${randomUUID().slice(0, 8)}`;
	}
	const org = await db.organization.create({
		data: {
			id: randomUUID(),
			name: membership.name,
			slug,
			metadata: JSON.stringify({ kind: COMPANY }),
			createdAt: now,
		},
	});
	await db.externalRef.create({
		data: {
			entityType: 'organization',
			localId: org.id,
			issuer,
			externalId: membership.company,
		},
	});
	return org.id;
}

export async function ensureTeam(
	db: Pick<Db, 'team' | 'externalRef'>,
	issuer: string,
	organizationId: string,
	team: { id: string; name: string },
	now: Date
): Promise<string> {
	const ref = await refFor(db, 'team', issuer, team.id);
	if (ref) {
		const existing = await db.team.findUnique({
			where: { id: ref.localId },
		});
		if (existing && existing.organizationId === organizationId) {
			if (existing.name !== team.name) {
				await db.team.update({
					where: { id: existing.id },
					data: { name: team.name, updatedAt: now },
				});
			}
			return existing.id;
		}
		await db.externalRef.delete({ where: { id: ref.id } });
	}

	const created = await db.team.create({
		data: {
			id: randomUUID(),
			name: team.name,
			organizationId,
			createdAt: now,
			memberCount: 0,
		},
	});
	await db.externalRef.create({
		data: {
			entityType: 'team',
			localId: created.id,
			issuer,
			externalId: team.id,
		},
	});
	return created.id;
}

/// `memberCount` is otherwise kept up to date by the organization plugin.
/// Whoever writes the rows themselves recounts.
export async function recount(
	db: Pick<Db, 'team' | 'teamMember'>,
	teamIds: Iterable<string>,
	now: Date
) {
	for (const teamId of new Set(teamIds)) {
		const memberCount = await db.teamMember.count({ where: { teamId } });
		await db.team.update({
			where: { id: teamId },
			data: { memberCount, updatedAt: now },
		});
	}
}

async function syncTeams(
	db: Db,
	claims: WireCloudClaims,
	organizationId: string,
	userId: string,
	membership: WireCloudMembership,
	now: Date
): Promise<boolean> {
	const touched = new Set<string>();
	const claimed = new Set<string>();

	for (const team of membership.teams) {
		const teamId = await ensureTeam(
			db,
			claims.issuer,
			organizationId,
			team,
			now
		);
		claimed.add(teamId);
		const present = await db.teamMember.findFirst({
			where: { teamId, userId },
			select: { id: true },
		});
		if (!present) {
			await db.teamMember.create({
				data: {
					id: randomUUID(),
					teamId,
					userId,
					membershipKey: `${teamId}:${userId}`,
					createdAt: now,
				},
			});
			touched.add(teamId);
		}
	}

	// Truncated lists are not complete: then nothing is removed, otherwise
	// someone would lose teams that merely no longer fit into the token.
	if (!claims.teamsTruncated) {
		const mine = await db.teamMember.findMany({
			where: { userId, team: { organizationId } },
			select: { id: true, teamId: true },
		});
		const refs = await db.externalRef.findMany({
			where: {
				entityType: 'team',
				issuer: claims.issuer,
				localId: { in: mine.map((tm) => tm.teamId) },
			},
			select: { localId: true },
		});
		const managed = new Set(refs.map((ref) => ref.localId));
		for (const tm of mine) {
			if (managed.has(tm.teamId) && !claimed.has(tm.teamId)) {
				await db.teamMember.delete({ where: { id: tm.id } });
				touched.add(tm.teamId);
			}
		}
	}

	await recount(db, touched, now);
	return touched.size > 0;
}

/// Removes the memberships in companies managed by WireCloud that the token
/// no longer names, along with the person's teams in those companies.
async function dropRevoked(
	db: Db,
	claims: WireCloudClaims,
	userId: string,
	wantedOrganizations: Set<string>,
	now: Date
) {
	const members = await db.member.findMany({
		where: { userId },
		select: { id: true, organizationId: true },
	});
	const candidates = members.filter(
		(member) => !wantedOrganizations.has(member.organizationId)
	);
	if (candidates.length === 0) return;

	const refs = await db.externalRef.findMany({
		where: {
			entityType: 'organization',
			issuer: claims.issuer,
			localId: { in: candidates.map((member) => member.organizationId) },
		},
		select: { localId: true },
	});
	const managed = new Set(refs.map((ref) => ref.localId));

	for (const member of candidates) {
		if (!managed.has(member.organizationId)) continue;
		await removeMembership(db, userId, member.organizationId, now);
	}
}

/// Takes a person's membership in an organization away, along with their
/// teams there. Shared by the sync (the token no longer names the company) and
/// the events from WireCloud (revocation).
export async function removeMembership(
	db: Pick<Db, 'member' | 'team' | 'teamMember'>,
	userId: string,
	organizationId: string,
	now: Date
) {
	const teams = await db.teamMember.findMany({
		where: { userId, team: { organizationId } },
		select: { teamId: true },
	});
	await db.teamMember.deleteMany({
		where: { userId, team: { organizationId } },
	});
	await db.member.deleteMany({ where: { userId, organizationId } });
	await recount(
		db,
		teams.map((tm) => tm.teamId),
		now
	);
}

/// Syncs a verified token with the stored state and returns the local user
/// ID.
export async function syncFromClaims(
	claims: WireCloudClaims,
	deps: SyncDeps
): Promise<string> {
	for (const membership of claims.memberships) {
		if (!ROLES.has(membership.toolRole)) {
			throw new HttpError(403, ErrorCodes.WIRECLOUD_UNKNOWN_ROLE);
		}
	}

	const now = (deps.now ?? (() => new Date()))();
	const userId = await ensureUser(deps, claims);

	await deps.prisma.$transaction(async (tx) => {
		const db = tx as unknown as Db;
		const wanted = new Set<string>();

		for (const membership of claims.memberships) {
			const organizationId = await ensureOrganization(
				db,
				claims.issuer,
				membership,
				now
			);
			wanted.add(organizationId);

			const member = await db.member.findFirst({
				where: { organizationId, userId },
				select: { id: true, role: true },
			});
			const roleChanged = !member || member.role !== membership.toolRole;
			if (!member) {
				await db.member.create({
					data: {
						id: randomUUID(),
						organizationId,
						userId,
						role: membership.toolRole,
						createdAt: now,
					},
				});
			} else if (member.role !== membership.toolRole) {
				await db.member.update({
					where: { id: member.id },
					data: { role: membership.toolRole },
				});
			}

			const teamsChanged = await syncTeams(
				db,
				claims,
				organizationId,
				userId,
				membership,
				now
			);
			if (roleChanged || teamsChanged) {
				await markAccessChanged(db, organizationId, [userId]);
			}
		}

		await dropRevoked(db, claims, userId, wanted, now);
	});

	return userId;
}
