import { beforeEach, vi } from 'vitest';
import { installAuthMock } from './helpers/auth';
import { prismaMock } from './helpers/prisma';

beforeEach(() => {
	vi.resetAllMocks();
	installAuthMock();
	// `workspaceAccess` asks for the projects a member created. Unless a test
	// says otherwise, there are none; every other query stays unanswered, as
	// after the reset.
	prismaMock.project.findMany.mockImplementation(async (query) =>
		query?.where?.createdById ? [] : undefined
	);
});
