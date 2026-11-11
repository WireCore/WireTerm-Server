import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../helpers/fakeDb';
import { syncFromClaims } from '../../src/services/WireCloudSyncService';
import type { WireCloudClaims } from '../../src/lib/wirecloud';
import { ErrorCodes } from '../../src/utils/ErrorCodes';
import { HttpError } from '../../src/utils/http';

const NOW = new Date('2026-10-31T12:00:00Z');
const ISSUER = 'http://wirecloud.test';

function claims(overrides: Partial<WireCloudClaims> = {}): WireCloudClaims {
	return {
		issuer: ISSUER,
		subject: 'acc-1',
		audience: 'http://wireterm.test',
		issuedAt: 1000,
		expiresAt: 1600,
		tokenId: 'jti-1',
		version: 1,
		account: {
			type: 'personal',
			name: 'Max Muster',
			email: 'max@example.test',
			emailVerified: true,
		},
		memberships: [
			{
				company: 'company-1',
				name: 'Acme GmbH',
				toolRole: 'admin',
				teams: [{ id: 'team-1', name: 'Support' }],
			},
		],
		teamsTruncated: false,
		...overrides,
	};
}

function setup() {
	const db = new FakeDb();
	const createUser = vi.fn(
		async (input: {
			email: string;
			name: string;
			emailVerified: boolean;
		}) => {
			const row = db.seed('user', { ...input });
			return { id: row.id as string };
		}
	);
	const ensurePersonalWorkspace = vi.fn(async () => {});
	const sync = (c: WireCloudClaims) =>
		syncFromClaims(c, {
			prisma: db as never,
			createUser,
			ensurePersonalWorkspace,
			now: () => NOW,
		});
	return { db, createUser, ensurePersonalWorkspace, sync };
}

function refOf(db: FakeDb, entityType: string, externalId: string) {
	return db.tables.externalRef.find(
		(r) => r.entityType === entityType && r.externalId === externalId
	);
}

describe('first call (criterion 5)', () => {
	it('creates user, organization, member, team and team membership', async () => {
		const { db, sync, createUser, ensurePersonalWorkspace } = setup();
		const userId = await sync(claims());

		expect(createUser).toHaveBeenCalledWith({
			email: 'max@example.test',
			name: 'Max Muster',
			emailVerified: true,
		});
		expect(ensurePersonalWorkspace).toHaveBeenCalledWith(userId);
		expect(refOf(db, 'user', 'acc-1')?.localId).toBe(userId);

		const org = db.tables.organization[0];
		expect(org).toMatchObject({
			name: 'Acme GmbH',
			slug: 'company-company-1',
			metadata: '{"kind":"company"}',
		});
		expect(refOf(db, 'organization', 'company-1')?.localId).toBe(org.id);

		expect(db.tables.member).toHaveLength(1);
		expect(db.tables.member[0]).toMatchObject({
			organizationId: org.id,
			userId,
			role: 'admin',
		});

		const team = db.tables.team[0] as { id: string };
		expect(team).toMatchObject({
			name: 'Support',
			organizationId: org.id,
			memberCount: 1,
		});
		expect(refOf(db, 'team', 'team-1')?.localId).toBe(team.id);
		expect(db.tables.teamMember).toHaveLength(1);
		expect(db.tables.teamMember[0]).toMatchObject({
			teamId: team.id,
			userId,
			membershipKey: `${team.id}:${userId}`,
		});
	});

	it('does not create the account again on any later call', async () => {
		const { db, sync, createUser } = setup();
		const first = await sync(claims());
		const second = await sync(claims({ tokenId: 'jti-2' }));

		expect(second).toBe(first);
		expect(createUser).toHaveBeenCalledTimes(1);
		expect(db.tables.user).toHaveLength(1);
		expect(db.tables.organization).toHaveLength(1);
		expect(db.tables.member).toHaveLength(1);
		expect(db.tables.team).toHaveLength(1);
		expect(db.tables.teamMember).toHaveLength(1);
		expect(db.tables.externalRef).toHaveLength(3);
	});

	it('creates a token without a company without an organization', async () => {
		const { db, sync, ensurePersonalWorkspace } = setup();
		const userId = await sync(claims({ memberships: [] }));
		expect(db.tables.organization).toHaveLength(0);
		expect(db.tables.member).toHaveLength(0);
		expect(ensurePersonalWorkspace).toHaveBeenCalledWith(userId);
	});

	it('keeps several companies, each with its own role', async () => {
		const { db, sync } = setup();
		await sync(
			claims({
				memberships: [
					{
						company: 'c1',
						name: 'Acme',
						toolRole: 'owner',
						teams: [],
					},
					{
						company: 'c2',
						name: 'Zeta',
						toolRole: 'member',
						teams: [],
					},
				],
			})
		);
		expect(db.tables.organization.map((o) => o.name).sort()).toEqual([
			'Acme',
			'Zeta',
		]);
		expect(db.tables.member.map((m) => m.role).sort()).toEqual([
			'member',
			'owner',
		]);
	});

	it('shares a company between two accounts', async () => {
		const { db, sync } = setup();
		await sync(claims());
		await sync(
			claims({
				subject: 'acc-2',
				account: {
					type: 'personal',
					name: 'Anna',
					email: 'anna@example.test',
					emailVerified: true,
				},
				memberships: [
					{
						company: 'company-1',
						name: 'Acme GmbH',
						toolRole: 'member',
						teams: [{ id: 'team-1', name: 'Support' }],
					},
				],
			})
		);
		expect(db.tables.user).toHaveLength(2);
		expect(db.tables.organization).toHaveLength(1);
		expect(db.tables.team).toHaveLength(1);
		expect(db.tables.member).toHaveLength(2);
		expect(db.tables.team[0].memberCount).toBe(2);
	});
});

describe('reconciling', () => {
	it('reconciles role as well as company and team names', async () => {
		const { db, sync } = setup();
		await sync(claims());
		await sync(
			claims({
				tokenId: 'jti-2',
				memberships: [
					{
						company: 'company-1',
						name: 'Acme AG',
						toolRole: 'member',
						teams: [{ id: 'team-1', name: 'Customer service' }],
					},
				],
			})
		);
		expect(db.tables.member[0].role).toBe('member');
		expect(db.tables.organization[0].name).toBe('Acme AG');
		expect(db.tables.team[0].name).toBe('Customer service');
	});

	it('marks the access as changed when role or teams change, not otherwise', async () => {
		const { db, sync } = setup();
		await sync(claims());
		const first = db.tables.member[0].accessRevision;
		expect(first).toBe(db.tables.organization[0].revision);

		await sync(claims({ tokenId: 'jti-2' }));
		expect(db.tables.member[0].accessRevision).toBe(first);

		await sync(
			claims({
				tokenId: 'jti-3',
				memberships: [
					{
						company: 'company-1',
						name: 'Acme GmbH',
						toolRole: 'admin',
						teams: [],
					},
				],
			})
		);
		expect(db.tables.member[0].accessRevision).not.toBe(first);
		expect(db.tables.member[0].accessRevision).toBe(
			db.tables.organization[0].revision
		);
	});

	it('reconciles name and verification of the account', async () => {
		const { db, sync } = setup();
		await sync(claims());
		await sync(
			claims({
				tokenId: 'jti-2',
				account: {
					type: 'personal',
					name: 'Maximilian Muster',
					email: 'max@example.test',
					emailVerified: false,
				},
			})
		);
		expect(db.tables.user[0]).toMatchObject({
			name: 'Maximilian Muster',
			emailVerified: false,
		});
	});

	it('takes over a new address only if it does not belong to another account', async () => {
		const { db, sync } = setup();
		await sync(claims());
		db.seed('user', { email: 'taken@example.test', name: 'Other' });

		await sync(
			claims({
				tokenId: 'jti-2',
				account: {
					type: 'personal',
					name: 'Max Muster',
					email: 'taken@example.test',
					emailVerified: true,
				},
			})
		);
		expect(db.tables.user[0].email).toBe('max@example.test');

		await sync(
			claims({
				tokenId: 'jti-3',
				account: {
					type: 'personal',
					name: 'Max Muster',
					email: 'new@example.test',
					emailVerified: true,
				},
			})
		);
		expect(db.tables.user[0].email).toBe('new@example.test');
	});

	it('creates the company again if the mapping points nowhere', async () => {
		const { db, sync } = setup();
		await sync(claims());
		// The organization is deleted (e.g. by hand), the mapping remains.
		db.tables.organization.length = 0;
		db.tables.member.length = 0;
		await sync(claims({ tokenId: 'jti-2' }));
		expect(db.tables.organization).toHaveLength(1);
		expect(db.tables.member).toHaveLength(1);
		expect(
			db.tables.externalRef.filter((r) => r.entityType === 'organization')
		).toHaveLength(1);
	});
});

describe('revocation during sync', () => {
	it('removes a team the token no longer names, and recounts', async () => {
		const { db, sync } = setup();
		await sync(claims());
		expect(db.tables.teamMember).toHaveLength(1);

		await sync(
			claims({
				tokenId: 'jti-2',
				memberships: [
					{
						company: 'company-1',
						name: 'Acme GmbH',
						toolRole: 'admin',
						teams: [],
					},
				],
			})
		);
		expect(db.tables.teamMember).toHaveLength(0);
		expect(db.tables.team[0].memberCount).toBe(0);
		// The team itself remains for the other members.
		expect(db.tables.team).toHaveLength(1);
	});

	it('leaves a team of its own, not managed by WireCloud, untouched', async () => {
		const { db, sync } = setup();
		const userId = await sync(claims());
		const org = db.tables.organization[0];
		const local = db.seed('team', {
			name: 'Local',
			organizationId: org.id,
			memberCount: 1,
		});
		db.seed('teamMember', { teamId: local.id, userId });

		await sync(
			claims({
				tokenId: 'jti-2',
				memberships: [
					{
						company: 'company-1',
						name: 'Acme GmbH',
						toolRole: 'admin',
						teams: [],
					},
				],
			})
		);
		expect(db.tables.teamMember.map((tm) => tm.teamId)).toEqual([local.id]);
	});

	it('removes nothing if the team list is truncated', async () => {
		const { db, sync } = setup();
		await sync(claims());
		await sync(
			claims({
				tokenId: 'jti-2',
				teamsTruncated: true,
				memberships: [
					{
						company: 'company-1',
						name: 'Acme GmbH',
						toolRole: 'admin',
						teams: [],
					},
				],
			})
		);
		expect(db.tables.teamMember).toHaveLength(1);
	});

	it('removes the membership in a company the token no longer names', async () => {
		const { db, sync } = setup();
		const userId = await sync(claims());
		expect(db.tables.member).toHaveLength(1);

		await sync(claims({ tokenId: 'jti-2', memberships: [] }));
		expect(
			db.tables.member.filter((m) => m.userId === userId)
		).toHaveLength(0);
		expect(db.tables.teamMember).toHaveLength(0);
		expect(db.tables.team[0].memberCount).toBe(0);
		// The company is kept for the other members.
		expect(db.tables.organization).toHaveLength(1);
	});

	it('leaves the personal workspace untouched', async () => {
		const { db, sync } = setup();
		const userId = await sync(claims({ memberships: [] }));
		const personal = db.seed('organization', {
			name: 'Personal',
			slug: `personal-${userId}`,
			metadata: '{"kind":"personal"}',
		});
		db.seed('member', {
			organizationId: personal.id,
			userId,
			role: 'owner',
		});

		await sync(claims({ tokenId: 'jti-2', memberships: [] }));
		expect(db.tables.member).toHaveLength(1);
		expect(db.tables.member[0].organizationId).toBe(personal.id);
	});

	it('removes no membership that comes from another issuer', async () => {
		const { db, sync } = setup();
		const userId = await sync(claims({ memberships: [] }));
		const foreign = db.seed('organization', {
			name: 'Foreign',
			slug: 'foreign',
		});
		db.seed('member', {
			organizationId: foreign.id,
			userId,
			role: 'member',
		});
		db.seed('externalRef', {
			entityType: 'organization',
			localId: foreign.id,
			issuer: 'http://other-issuer.test',
			externalId: 'x',
		});

		await sync(claims({ tokenId: 'jti-2', memberships: [] }));
		expect(
			db.tables.member.some((m) => m.organizationId === foreign.id)
		).toBe(true);
	});
});

describe('rejections', () => {
	it('rejects a role WireTerm does not know, and writes nothing', async () => {
		const { db, sync, createUser } = setup();
		const error = await sync(
			claims({
				memberships: [
					{
						company: 'c',
						name: 'n',
						toolRole: 'superuser',
						teams: [],
					},
				],
			})
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(HttpError);
		expect((error as HttpError).status).toBe(403);
		expect((error as HttpError).code).toBe(
			ErrorCodes.WIRECLOUD_UNKNOWN_ROLE
		);
		expect(createUser).not.toHaveBeenCalled();
		expect(db.tables.user).toHaveLength(0);
	});

	it('does not link an existing local account via the email address', async () => {
		const { db, sync, createUser } = setup();
		db.seed('user', { email: 'max@example.test', name: 'Local' });

		const error = await sync(claims()).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(HttpError);
		expect((error as HttpError).status).toBe(409);
		expect((error as HttpError).code).toBe(
			ErrorCodes.WIRECLOUD_EMAIL_CONFLICT
		);
		expect(createUser).not.toHaveBeenCalled();
		expect(db.tables.externalRef).toHaveLength(0);
		expect(db.tables.organization).toHaveLength(0);
	});

	it('compares addresses case-insensitively', async () => {
		const { db, sync, createUser } = setup();
		db.seed('user', { email: 'max@example.test', name: 'Local' });
		const error = await sync(
			claims({
				account: {
					type: 'personal',
					name: 'Max',
					email: 'Max@Example.TEST',
					emailVerified: true,
				},
			})
		).catch((e: unknown) => e);
		expect((error as HttpError).status).toBe(409);
		expect(createUser).not.toHaveBeenCalled();
	});

	it('creates new accounts with a lowercased address', async () => {
		const { sync, createUser } = setup();
		await sync(
			claims({
				account: {
					type: 'personal',
					name: 'Max',
					email: 'Max@Example.TEST',
					emailVerified: true,
				},
			})
		);
		expect(createUser).toHaveBeenCalledWith(
			expect.objectContaining({ email: 'max@example.test' })
		);
	});
});
