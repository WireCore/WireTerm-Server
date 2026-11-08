import { vi } from 'vitest';

const model = () => ({
	findMany: vi.fn(),
	findUnique: vi.fn(),
	findFirst: vi.fn(),
	count: vi.fn(),
	create: vi.fn(),
	createMany: vi.fn(),
	update: vi.fn(),
	updateMany: vi.fn(),
	upsert: vi.fn(),
	delete: vi.fn(),
	deleteMany: vi.fn(),
});

const prismaMock = {
	user: model(),
	member: model(),
	team: model(),
	teamMember: model(),
	organization: model(),
	project: model(),
	projectShare: model(),
	projectKey: model(),
	connection: model(),
	sshConnection: model(),
	ftpConnection: model(),
	s3Connection: model(),
	secret: model(),
	vaultAccount: model(),
	knownHostKey: model(),
	snippet: model(),
	userKey: model(),
	recoveryKey: model(),
	externalRef: model(),

	// Both forms the code uses: with a callback (interactive) and with a list
	// of promises.
	$transaction: vi.fn(async (argument: unknown) => {
		if (typeof argument === 'function') {
			return (argument as (tx: unknown) => unknown)(prismaMock);
		}
		return Promise.all(argument as Promise<unknown>[]);
	}),
};

export default prismaMock;
export { prismaMock };
