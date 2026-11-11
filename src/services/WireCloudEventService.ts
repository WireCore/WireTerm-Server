import { randomUUID } from 'node:crypto';
import type { PrismaClient } from 'generated/prisma/client';
import { markAccessChanged } from 'services/RevisionService';
import {
	ensureTeam,
	recount,
	removeMembership,
} from 'services/WireCloudSyncService';

/// Applies events from WireCloud (VERTRAG.md 7 and 9). They take away access,
/// never data: memberships and teams disappear, projects, connections and
/// secrets stay, as the contract provides for the organization. Whoever gets
/// access again later is recreated with the next token. The person's wrapped
/// project keys stay in place, so that `stale-keys` can name the projects
/// whose keys need to be renewed.
///
/// The one gain that is reported is a team (`team.member_added`): without it
/// the team would only arrive with the person's next token, and nobody could
/// wrap the project keys of that team for them before they open WireTerm. It
/// only applies to someone who is already a member here — a membership itself
/// still comes with the token.
///
/// Delivery is at least once and in order. Therefore:
/// - an `id` already seen is skipped (idempotent) and
/// - so is an event with a lower `sequence` than the last one applied for the
///   same company (or the same account), so that a late one never resets a
///   later state.

const ROLES: ReadonlySet<string> = new Set(['owner', 'admin', 'member']);

export const EVENT_TYPES = [
	'membership.revoked',
	'membership.role_changed',
	'team.deleted',
	'org.deleted',
	'account.suspended',
	'account.deleted',
	'team.member_added',
	'team.member_removed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type WireCloudEvent = {
	id: string;
	type: string;
	sequence: number;
	company?: string;
	account?: string;
	team?: string;
	/// Only `team.member_added`: the team may not exist here yet.
	team_name?: string;
	role?: string;
};

export type EventResult = {
	applied: number;
	/// Already seen or superseded.
	ignored: number;
	/// Unknown type, missing field or unknown role: not applied, but
	/// acknowledged, otherwise WireCloud would redeliver it forever.
	rejected: number;
};

type Db = PrismaClient;
type Tx = Pick<
	PrismaClient,
	| 'externalEvent'
	| 'externalRef'
	| 'member'
	| 'team'
	| 'teamMember'
	| 'organization'
>;

async function localIdOf(
	db: Tx,
	entityType: 'user' | 'organization' | 'team',
	issuer: string,
	externalId: string
): Promise<string | undefined> {
	const ref = await db.externalRef.findUnique({
		where: {
			entityType_issuer_externalId: { entityType, issuer, externalId },
		},
	});
	return ref?.localId;
}

/// The key under which the order is tracked.
function scopeOf(event: WireCloudEvent): string | undefined {
	if (event.company) return `company:${event.company}`;
	if (event.account) return `account:${event.account}`;
	return undefined;
}

/// Does the event have the fields its type needs?
function wellFormed(event: WireCloudEvent): boolean {
	switch (event.type) {
		case 'membership.revoked':
			return !!event.company && !!event.account;
		case 'membership.role_changed':
			return (
				!!event.company &&
				!!event.account &&
				!!event.role &&
				ROLES.has(event.role)
			);
		case 'team.deleted':
			return !!event.company && !!event.team;
		case 'org.deleted':
			return !!event.company;
		case 'account.suspended':
		case 'account.deleted':
			return !!event.account;
		case 'team.member_added':
			return (
				!!event.company &&
				!!event.account &&
				!!event.team &&
				!!event.team_name
			);
		case 'team.member_removed':
			return !!event.company && !!event.account && !!event.team;
		default:
			return false;
	}
}

async function apply(
	db: Tx,
	issuer: string,
	event: WireCloudEvent,
	now: Date
): Promise<void> {
	switch (event.type) {
		case 'membership.revoked': {
			const [userId, orgId] = await Promise.all([
				localIdOf(db, 'user', issuer, event.account!),
				localIdOf(db, 'organization', issuer, event.company!),
			]);
			if (userId && orgId) await removeMembership(db, userId, orgId, now);
			return;
		}
		case 'membership.role_changed': {
			const [userId, orgId] = await Promise.all([
				localIdOf(db, 'user', issuer, event.account!),
				localIdOf(db, 'organization', issuer, event.company!),
			]);
			if (!userId || !orgId) return;
			const member = await db.member.findFirst({
				where: { userId, organizationId: orgId },
			});
			if (member && member.role !== event.role) {
				await db.member.update({
					where: { id: member.id },
					data: { role: event.role },
				});
				await markAccessChanged(db, orgId, [userId]);
			}
			return;
		}
		case 'team.member_added': {
			const [userId, orgId] = await Promise.all([
				localIdOf(db, 'user', issuer, event.account!),
				localIdOf(db, 'organization', issuer, event.company!),
			]);
			if (!userId || !orgId) return;
			const member = await db.member.findFirst({
				where: { userId, organizationId: orgId },
				select: { id: true },
			});
			if (!member) return;
			const teamId = await ensureTeam(
				db,
				issuer,
				orgId,
				{ id: event.team!, name: event.team_name! },
				now
			);
			const present = await db.teamMember.findFirst({
				where: { teamId, userId },
				select: { id: true },
			});
			if (present) return;
			await db.teamMember.create({
				data: {
					id: randomUUID(),
					teamId,
					userId,
					membershipKey: `${teamId}:${userId}`,
					createdAt: now,
				},
			});
			await recount(db, [teamId], now);
			await markAccessChanged(db, orgId, [userId]);
			return;
		}
		case 'team.member_removed': {
			const [userId, orgId, teamId] = await Promise.all([
				localIdOf(db, 'user', issuer, event.account!),
				localIdOf(db, 'organization', issuer, event.company!),
				localIdOf(db, 'team', issuer, event.team!),
			]);
			if (!userId || !orgId || !teamId) return;
			const { count } = await db.teamMember.deleteMany({
				where: { teamId, userId, team: { organizationId: orgId } },
			});
			if (count === 0) return;
			await recount(db, [teamId], now);
			await markAccessChanged(db, orgId, [userId]);
			return;
		}
		case 'team.deleted': {
			const teamId = await localIdOf(db, 'team', issuer, event.team!);
			if (!teamId) return;
			await db.teamMember.deleteMany({ where: { teamId } });
			await db.team.delete({ where: { id: teamId } }).catch(() => {
				// Already gone: nothing to do.
			});
			await db.externalRef.deleteMany({
				where: { entityType: 'team', issuer, externalId: event.team },
			});
			return;
		}
		case 'org.deleted': {
			const orgId = await localIdOf(
				db,
				'organization',
				issuer,
				event.company!
			);
			if (!orgId) return;
			const teams = await db.team.findMany({
				where: { organizationId: orgId },
				select: { id: true },
			});
			await db.teamMember.deleteMany({
				where: { team: { organizationId: orgId } },
			});
			await db.member.deleteMany({ where: { organizationId: orgId } });
			await recount(
				db,
				teams.map((team) => team.id),
				now
			);
			return;
		}
		case 'account.suspended':
		case 'account.deleted': {
			const userId = await localIdOf(db, 'user', issuer, event.account!);
			if (!userId) return;
			// Only the companies managed by WireCloud, never "Personal".
			const members = await db.member.findMany({
				where: { userId },
				select: { organizationId: true },
			});
			const refs = await db.externalRef.findMany({
				where: {
					entityType: 'organization',
					issuer,
					localId: { in: members.map((m) => m.organizationId) },
				},
				select: { localId: true },
			});
			for (const ref of refs) {
				await removeMembership(db, userId, ref.localId, now);
			}
			return;
		}
	}
}

/// Applies the events in the order delivered. Each in its own transaction: if
/// one fails, it leaves no trace, and WireCloud redelivers the batch.
export async function applyEvents(
	events: WireCloudEvent[],
	deps: { prisma: Db; issuer: string; now?: () => Date }
): Promise<EventResult> {
	const result: EventResult = { applied: 0, ignored: 0, rejected: 0 };
	const now = (deps.now ?? (() => new Date()))();

	for (const event of events) {
		const outcome = await deps.prisma.$transaction(async (tx) => {
			const db = tx as unknown as Tx;
			const seen = await db.externalEvent.findUnique({
				where: {
					issuer_eventId: { issuer: deps.issuer, eventId: event.id },
				},
			});
			if (seen) return 'ignored' as const;

			const scopeKey = scopeOf(event);
			const ok = scopeKey !== undefined && wellFormed(event);
			if (scopeKey) {
				const latest = await db.externalEvent.findFirst({
					where: { issuer: deps.issuer, scopeKey },
					orderBy: { sequence: 'desc' },
				});
				if (latest && event.sequence <= Number(latest.sequence)) {
					return 'ignored' as const;
				}
			}
			if (ok) await apply(db, deps.issuer, event, now);
			if (scopeKey) {
				await db.externalEvent.create({
					data: {
						issuer: deps.issuer,
						eventId: event.id,
						scopeKey,
						sequence: BigInt(event.sequence),
						type: event.type.slice(0, 48),
					},
				});
			}
			return ok ? ('applied' as const) : ('rejected' as const);
		});
		if (outcome === 'applied') result.applied++;
		else if (outcome === 'ignored') result.ignored++;
		else result.rejected++;
	}
	return result;
}
