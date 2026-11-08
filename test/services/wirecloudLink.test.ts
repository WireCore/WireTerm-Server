import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../helpers/fakeDb';
import {
	linkLocalAccount,
	resetLinkAttempts,
} from '../../src/services/WireCloudLinkService';
import type { WireCloudClaims } from '../../src/lib/wirecloud';
import { ErrorCodes } from '../../src/utils/ErrorCodes';

const ISSUER = 'http://wirecloud.test';

function claims(overrides: Partial<WireCloudClaims['account']> = {}) {
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
			...overrides,
		},
		memberships: [],
		teamsTruncated: false,
	} as WireCloudClaims;
}

const HASH = 'hash-of-secret';

function setup() {
	const db = new FakeDb();
	const user = db.seed('user', {
		email: 'max@example.test',
		name: 'Max Local',
	});
	db.seed('account', {
		userId: user.id,
		providerId: 'credential',
		password: HASH,
	});
	const verifyPassword = vi.fn(
		async (hash: string, password: string) =>
			hash === HASH && password === 'secret'
	);
	const ensurePersonalWorkspace = vi.fn(async () => {});
	let now = 1_000_000;
	const link = (c: WireCloudClaims, password: string) =>
		linkLocalAccount(c, password, {
			prisma: db as never,
			verifyPassword,
			ensurePersonalWorkspace,
			now: () => now,
		});
	return {
		db,
		user,
		link,
		verifyPassword,
		ensurePersonalWorkspace,
		advance: (ms: number) => (now += ms),
	};
}

const code = (error: unknown) => error as { status: number; code: ErrorCodes };

beforeEach(() => resetLinkAttempts());

describe('linking a local account', () => {
	it('links with a verified address and the correct password', async () => {
		const { db, user, link, ensurePersonalWorkspace } = setup();
		await expect(link(claims(), 'secret')).resolves.toEqual({
			linked: true,
		});
		expect(db.tables.externalRef).toHaveLength(1);
		expect(db.tables.externalRef[0]).toMatchObject({
			entityType: 'user',
			localId: user.id,
			issuer: ISSUER,
			externalId: 'acc-1',
		});
		expect(ensurePersonalWorkspace).toHaveBeenCalledWith(user.id);
	});

	it('links regardless of the casing of the address', async () => {
		const { db, link } = setup();
		await link(claims({ email: 'Max@Example.TEST' }), 'secret');
		expect(db.tables.externalRef).toHaveLength(1);
	});

	it('rejects a wrong password and writes nothing', async () => {
		const { db, link } = setup();
		const error = await link(claims(), 'wrong').catch((e: unknown) => e);
		expect(code(error)).toMatchObject({
			status: 403,
			code: ErrorCodes.WIRECLOUD_LINK_DENIED,
		});
		expect(db.tables.externalRef).toHaveLength(0);
	});

	it('requires a verified address in the token, even with the correct password', async () => {
		const { db, link, verifyPassword } = setup();
		const error = await link(
			claims({ emailVerified: false }),
			'secret'
		).catch((e: unknown) => e);
		expect(code(error)).toMatchObject({
			status: 403,
			code: ErrorCodes.WIRECLOUD_LINK_UNVERIFIED,
		});
		expect(verifyPassword).not.toHaveBeenCalled();
		expect(db.tables.externalRef).toHaveLength(0);
	});

	it('has nothing to link without a local account', async () => {
		const { link, db } = setup();
		const error = await link(
			claims({ email: 'new@example.test' }),
			'secret'
		).catch((e: unknown) => e);
		expect(code(error)).toMatchObject({
			status: 404,
			code: ErrorCodes.WIRECLOUD_LINK_NOT_NEEDED,
		});
		expect(db.tables.externalRef).toHaveLength(0);
	});

	it('is repeatable and then no longer checks a password', async () => {
		const { db, link, verifyPassword } = setup();
		await link(claims(), 'secret');
		verifyPassword.mockClear();
		await expect(link(claims(), 'anything')).resolves.toEqual({
			linked: true,
		});
		expect(verifyPassword).not.toHaveBeenCalled();
		expect(db.tables.externalRef).toHaveLength(1);
	});

	it('does not hand over an account that already has another WireCloud account', async () => {
		const { db, link } = setup();
		await link(claims(), 'secret');
		// A second WireCloud account with the same address and the same password.
		const error = await link(
			{ ...claims(), subject: 'acc-2' },
			'secret'
		).catch((e: unknown) => e);
		expect(code(error)).toMatchObject({
			status: 403,
			code: ErrorCodes.WIRECLOUD_LINK_DENIED,
		});
		expect(db.tables.externalRef).toHaveLength(1);
		expect(db.tables.externalRef[0].externalId).toBe('acc-1');
	});

	it('rejects an account without a sign-in password', async () => {
		const { db, link } = setup();
		db.tables.account.length = 0;
		const error = await link(claims(), 'secret').catch((e: unknown) => e);
		expect(code(error).status).toBe(403);
		expect(db.tables.externalRef).toHaveLength(0);
	});

	it('slows down guessing: after five failed attempts not even the correct password works', async () => {
		const { db, link, verifyPassword } = setup();
		for (let i = 0; i < 5; i++) {
			await link(claims(), 'wrong').catch(() => undefined);
		}
		verifyPassword.mockClear();
		const error = await link(claims(), 'secret').catch((e: unknown) => e);
		expect(code(error)).toMatchObject({
			status: 429,
			code: ErrorCodes.WIRECLOUD_LINK_RATE_LIMITED,
		});
		expect(verifyPassword).not.toHaveBeenCalled();
		expect(db.tables.externalRef).toHaveLength(0);
	});

	it('lifts the brake again after the time window', async () => {
		const { db, link, advance } = setup();
		for (let i = 0; i < 5; i++) {
			await link(claims(), 'wrong').catch(() => undefined);
		}
		advance(15 * 60 * 1000 + 1);
		await expect(link(claims(), 'secret')).resolves.toEqual({
			linked: true,
		});
		expect(db.tables.externalRef).toHaveLength(1);
	});

	it('counts failed attempts per WireCloud account, not jointly', async () => {
		const { link } = setup();
		for (let i = 0; i < 5; i++) {
			await link(claims(), 'wrong').catch(() => undefined);
		}
		const other = { ...claims(), subject: 'acc-9' };
		const error = await link(other, 'wrong').catch((e: unknown) => e);
		expect(code(error).status).toBe(403);
	});
});
