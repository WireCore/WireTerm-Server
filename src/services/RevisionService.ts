import type { Prisma } from 'generated/prisma/client';

/// The workspace's change counter, advanced by one.
///
/// Every row that is written gets the value the counter had at that moment.
/// `GET /sync?since=N` therefore returns exactly what has happened since —
/// including the tombstones, because a deleted project is a change like any
/// other.
///
/// Always runs inside the transaction that also writes the row: otherwise the
/// row would carry a value the counter has not reached yet, and a client
/// asking in between would miss it forever.
export async function nextRevision(
	tx: Prisma.TransactionClient,
	organizationId: string
): Promise<bigint> {
	const organization = await tx.organization.update({
		where: { id: organizationId },
		data: { revision: { increment: 1 } },
		select: { revision: true },
	});
	return organization.revision;
}
