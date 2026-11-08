import { describe, expect, test, vi } from 'vitest';
import { prismaMock } from '../helpers/prisma';
import {
	ensurePersonalWorkspace,
	personalSlug,
	PERSONAL_NAMES,
	workspaceKind,
} from '../../src/services/WorkspaceService';

describe('kind of a workspace', () => {
	test('recognizes the personal one by its metadata', () => {
		// Prisma returns the column as text …
		expect(workspaceKind('{"kind":"personal"}')).toBe('personal');
		// … better-auth returns it parsed.
		expect(workspaceKind({ kind: 'personal' })).toBe('personal');
	});

	test('everything else is an ordinary organization', () => {
		expect(workspaceKind(null)).toBe('organization');
		expect(workspaceKind('')).toBe('organization');
		expect(workspaceKind('{"kind":"business"}')).toBe('organization');
		expect(workspaceKind({})).toBe('organization');
	});

	test('anything unreadable does not count as personal', () => {
		// When in doubt, better one workspace too few protected than one that
		// wrongly can no longer be deleted.
		expect(workspaceKind('{broken')).toBe('organization');
	});
});

describe('slug of the personal workspace', () => {
	test('comes from the user ID, not from the name', () => {
		// Otherwise two people with the same name would spoil each other's
		// sign-up — the slug is unique.
		expect(personalSlug('AbC123')).toBe('personal-abc123');
		expect(personalSlug('user-1')).not.toBe(personalSlug('user-2'));
	});
});

describe('creating the personal workspace', () => {
	const createOrganization = vi.fn();
	const auth = {
		api: { createOrganization },
	} as never as Parameters<typeof ensurePersonalWorkspace>[0];

	test('creates organization and membership through the plugin', async () => {
		prismaMock.organization.findUnique.mockResolvedValue(null);

		await ensurePersonalWorkspace(auth, 'user-1');

		const body = createOrganization.mock.calls[0][0].body;
		expect(body).toEqual({
			name: PERSONAL_NAMES.en,
			slug: 'personal-user-1',
			userId: 'user-1',
			metadata: { kind: 'personal' },
		});
		// Without headers this is the system call the plugin provides for it.
		expect(createOrganization.mock.calls[0][0].headers).toBeUndefined();
	});

	test("is named in the user's language", async () => {
		prismaMock.organization.findUnique.mockResolvedValue(null);

		await ensurePersonalWorkspace(auth, 'user-1', 'de');

		const body = createOrganization.mock.calls[0][0].body;
		expect(body.name).toBe(PERSONAL_NAMES.de);
	});

	test('if it already exists, nothing happens', async () => {
		prismaMock.organization.findUnique.mockResolvedValue({
			id: 'organization-1',
		});

		await ensurePersonalWorkspace(auth, 'user-1');

		expect(createOrganization).not.toHaveBeenCalled();
	});
});
