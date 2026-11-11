import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../helpers/fakeDb';
import { syncFromClaims } from '../../src/services/WireCloudSyncService';
import {
	WireCloudEvent,
	applyEvents,
} from '../../src/services/WireCloudEventService';
import type { WireCloudClaims } from '../../src/lib/wirecloud';

const ISSUER = 'http://wirecloud.test';
const NOW = new Date('2026-10-31T12:00:00Z');

function claims(
	subject: string,
	role: string,
	teams: { id: string; name: string }[] = [{ id: 'team-1', name: 'Support' }]
): WireCloudClaims {
	return {
		issuer: ISSUER,
		subject,
		audience: 'http://wireterm.test',
		issuedAt: 1000,
		expiresAt: 1600,
		tokenId: `jti-${subject}`,
		version: 1,
		account: {
			type: 'personal',
			name: subject,
			email: `${subject}@example.test`,
			emailVerified: true,
		},
		memberships: [
			{ company: 'company-1', name: 'Acme', toolRole: role, teams },
		],
		teamsTruncated: false,
	};
}

let db: FakeDb;
let personalOrg: Record<string, unknown>;

async function sync(subject: string, role = 'member') {
	return syncFromClaims(claims(subject, role), {
		prisma: db as never,
		createUser: async (input) => ({
			id: (db.seed('user', { ...input }).id as string) ?? '',
		}),
		ensurePersonalWorkspace: async () => {},
		now: () => NOW,
	});
}

let seq = 0;
const event = (over: Partial<WireCloudEvent> & { type: string }) => ({
	id: `e${++seq}`,
	sequence: seq,
	...over,
});

const run = (events: WireCloudEvent[]) =>
	applyEvents(events, {
		prisma: db as never,
		issuer: ISSUER,
		now: () => NOW,
	});

const orgId = () => db.tables.organization[0].id as string;
const members = () => db.tables.member.map((m) => m.userId);

beforeEach(async () => {
	db = new FakeDb();
	seq = 0;
	// Two members of the same company and a personal workspace of bob.
	await sync('alice', 'owner');
	const bobId = await sync('bob', 'member');
	personalOrg = db.seed('organization', {
		name: 'Personal',
		slug: 'personal-bob',
		metadata: '{"kind":"personal"}',
	});
	db.seed('member', {
		organizationId: personalOrg.id,
		userId: bobId,
		role: 'owner',
	});
});

describe('membership.revoked', () => {
	it('removes membership and teams, leaves Personal and the others in place', async () => {
		const result = await run([
			event({
				type: 'membership.revoked',
				company: 'company-1',
				account: 'bob',
			}),
		]);
		expect(result).toEqual({ applied: 1, ignored: 0, rejected: 0 });

		const bob = db.tables.user.find((u) => u.name === 'bob')!;
		const alice = db.tables.user.find((u) => u.name === 'alice')!;
		expect(members()).toContain(alice.id);
		expect(members()).not.toContain(
			db.tables.member.find(
				(m) => m.userId === bob.id && m.organizationId === orgId()
			)?.userId
		);
		// Bob keeps "Personal".
		expect(
			db.tables.member.filter((m) => m.userId === bob.id)
		).toMatchObject([{ organizationId: personalOrg.id }]);
		// Team: only Alice remains, the counter is correct.
		expect(db.tables.teamMember.map((tm) => tm.userId)).toEqual([alice.id]);
		expect(db.tables.team[0].memberCount).toBe(1);
	});

	it('skips an event for an unknown account or unknown company without effect', async () => {
		const before = structuredClone(db.tables.member);
		const result = await run([
			event({
				type: 'membership.revoked',
				company: 'company-1',
				account: 'nobody',
			}),
			event({
				type: 'membership.revoked',
				company: 'company-9',
				account: 'bob',
			}),
		]);
		expect(result.applied).toBe(2);
		expect(db.tables.member).toEqual(before);
	});

	it('applies the same delivery only once', async () => {
		const e = event({
			type: 'membership.revoked',
			company: 'company-1',
			account: 'bob',
		});
		expect(await run([e])).toMatchObject({ applied: 1 });
		const count = db.operations;
		expect(await run([e])).toEqual({ applied: 0, ignored: 1, rejected: 0 });
		// Only the "already seen" check has read.
		expect(db.operations - count).toBe(1);
	});

	it('skips a late event with a lower sequence', async () => {
		await run([
			event({
				type: 'membership.role_changed',
				company: 'company-1',
				account: 'bob',
				role: 'admin',
				sequence: 10,
			}),
		]);
		const late = await run([
			event({
				type: 'membership.role_changed',
				company: 'company-1',
				account: 'bob',
				role: 'member',
				sequence: 5,
			}),
		]);
		expect(late).toEqual({ applied: 0, ignored: 1, rejected: 0 });
		expect(
			db.tables.member.find(
				(m) => m.role === 'admin' && m.organizationId === orgId()
			)
		).toBeTruthy();
	});

	it('keeps the sequence per company, not across all of them', async () => {
		await run([
			event({
				type: 'membership.revoked',
				company: 'company-2',
				account: 'bob',
				sequence: 100,
			}),
		]);
		const other = await run([
			event({
				type: 'membership.revoked',
				company: 'company-1',
				account: 'bob',
				sequence: 5,
			}),
		]);
		expect(other.applied).toBe(1);
	});
});

describe('membership.role_changed', () => {
	it('sets the role', async () => {
		await run([
			event({
				type: 'membership.role_changed',
				company: 'company-1',
				account: 'bob',
				role: 'admin',
			}),
		]);
		const bob = db.tables.user.find((u) => u.name === 'bob')!;
		const member = db.tables.member.find(
			(m) => m.userId === bob.id && m.organizationId === orgId()
		);
		expect(member?.role).toBe('admin');
		// As an admin bob now sees every project: his next sync starts from
		// zero.
		expect(member?.accessRevision).toBe(
			db.tables.organization.find((o) => o.id === orgId())!.revision
		);
	});

	it('rejects an unknown role, changes nothing and acknowledges', async () => {
		const result = await run([
			event({
				type: 'membership.role_changed',
				company: 'company-1',
				account: 'bob',
				role: 'superuser',
			}),
		]);
		expect(result).toEqual({ applied: 0, ignored: 0, rejected: 1 });
		expect(db.tables.member.some((m) => m.role === 'superuser')).toBe(
			false
		);
		// Acknowledged: the same delivery is not reprocessed endlessly.
		expect(db.tables.externalEvent).toHaveLength(1);
	});
});

describe('team.deleted', () => {
	it('removes team, team memberships and mapping, not the company', async () => {
		await run([
			event({
				type: 'team.deleted',
				company: 'company-1',
				team: 'team-1',
			}),
		]);
		expect(db.tables.team).toHaveLength(0);
		expect(db.tables.teamMember).toHaveLength(0);
		expect(
			db.tables.externalRef.filter((r) => r.entityType === 'team')
		).toHaveLength(0);
		expect(db.tables.organization.length).toBeGreaterThan(0);
		expect(db.tables.member.length).toBeGreaterThan(0);
	});
});

describe('team.member_added', () => {
	const bobsMember = () => {
		const bob = db.tables.user.find((u) => u.name === 'bob')!;
		return db.tables.member.find(
			(m) => m.userId === bob.id && m.organizationId === orgId()
		)!;
	};

	it('puts the member into a team that does not exist here yet, and marks their access as changed', async () => {
		const before = bobsMember().accessRevision;
		const result = await run([
			event({
				type: 'team.member_added',
				company: 'company-1',
				account: 'bob',
				team: 'team-2',
				team_name: 'Ops',
			}),
		]);
		expect(result).toEqual({ applied: 1, ignored: 0, rejected: 0 });

		const ops = db.tables.team.find((t) => t.name === 'Ops')!;
		expect(ops.organizationId).toBe(orgId());
		expect(ops.memberCount).toBe(1);
		expect(
			db.tables.teamMember.filter((tm) => tm.teamId === ops.id)
		).toMatchObject([{ userId: bobsMember().userId }]);
		// The next sync of bob starts from zero.
		expect(bobsMember().accessRevision).not.toBe(before);
		expect(bobsMember().accessRevision).toBe(
			db.tables.organization.find((o) => o.id === orgId())!.revision
		);
	});

	it('does nothing a second time for a team the member is already in', async () => {
		const before = bobsMember().accessRevision;
		await run([
			event({
				type: 'team.member_added',
				company: 'company-1',
				account: 'bob',
				team: 'team-1',
				team_name: 'Support',
			}),
		]);
		expect(db.tables.teamMember).toHaveLength(2);
		expect(bobsMember().accessRevision).toBe(before);
	});

	it('leaves someone alone who is not a member here — that comes with the token', async () => {
		const result = await run([
			event({
				type: 'team.member_added',
				company: 'company-1',
				account: 'carol',
				team: 'team-2',
				team_name: 'Ops',
			}),
		]);
		expect(result.applied).toBe(1);
		expect(db.tables.team).toHaveLength(1);
	});

	it('needs the name of the team', async () => {
		const result = await run([
			event({
				type: 'team.member_added',
				company: 'company-1',
				account: 'bob',
				team: 'team-2',
			}),
		]);
		expect(result).toEqual({ applied: 0, ignored: 0, rejected: 1 });
		expect(db.tables.team).toHaveLength(1);
	});
});

describe('team.member_removed', () => {
	it('takes the member out of the team, recounts and marks their access as changed', async () => {
		const bob = db.tables.user.find((u) => u.name === 'bob')!;
		await run([
			event({
				type: 'team.member_removed',
				company: 'company-1',
				account: 'bob',
				team: 'team-1',
			}),
		]);
		expect(db.tables.teamMember.some((tm) => tm.userId === bob.id)).toBe(
			false
		);
		expect(db.tables.team[0].memberCount).toBe(1);
		// The membership in the company stays.
		const member = db.tables.member.find(
			(m) => m.userId === bob.id && m.organizationId === orgId()
		)!;
		expect(member.accessRevision).toBe(
			db.tables.organization.find((o) => o.id === orgId())!.revision
		);
	});
});

describe('org.deleted', () => {
	it("revokes everyone's access, leaves organization and data in place", async () => {
		await run([event({ type: 'org.deleted', company: 'company-1' })]);
		expect(
			db.tables.member.filter((m) => m.organizationId === orgId())
		).toHaveLength(0);
		expect(db.tables.teamMember).toHaveLength(0);
		expect(db.tables.organization.some((o) => o.id === orgId())).toBe(true);
		// "Personal" stays.
		expect(
			db.tables.member.filter((m) => m.organizationId === personalOrg.id)
		).toHaveLength(1);
	});
});

describe('account.suspended and account.deleted', () => {
	for (const type of ['account.suspended', 'account.deleted']) {
		it(`${type} ends access in managed companies, never "Personal"`, async () => {
			await run([event({ type, account: 'bob' })]);
			const bob = db.tables.user.find((u) => u.name === 'bob')!;
			expect(
				db.tables.member.filter((m) => m.userId === bob.id)
			).toMatchObject([{ organizationId: personalOrg.id }]);
			// Account and data remain.
			expect(db.tables.user.some((u) => u.id === bob.id)).toBe(true);
			// Alice is untouched.
			const alice = db.tables.user.find((u) => u.name === 'alice')!;
			expect(db.tables.member.some((m) => m.userId === alice.id)).toBe(
				true
			);
		});
	}
});

describe('faulty events', () => {
	it('rejects unknown kinds and missing fields, but acknowledges them', async () => {
		const result = await run([
			event({ type: 'membership.exploded', company: 'company-1' }),
			event({ type: 'membership.revoked', company: 'company-1' }),
			event({ type: 'team.deleted', team: 'team-1' }),
			event({ type: 'account.deleted' }),
		]);
		expect(result.applied).toBe(0);
		expect(result.rejected).toBeGreaterThanOrEqual(3);
		expect(db.tables.member.length).toBeGreaterThan(0);
	});

	it('applies a delivery in the given order', async () => {
		const order: string[] = [];
		const spy = vi.spyOn(db.member, 'deleteMany');
		await run([
			event({
				type: 'membership.revoked',
				company: 'company-1',
				account: 'bob',
			}),
			event({
				type: 'membership.revoked',
				company: 'company-1',
				account: 'alice',
			}),
		]);
		for (const call of spy.mock.calls) {
			order.push(
				String((call[0] as { where: { userId: string } }).where.userId)
			);
		}
		const bob = db.tables.user.find((u) => u.name === 'bob')!.id;
		const alice = db.tables.user.find((u) => u.name === 'alice')!.id;
		expect(order).toEqual([bob, alice]);
	});
});
