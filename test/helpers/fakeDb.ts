import { randomUUID } from 'node:crypto';

/// A small in-memory database with the Prisma interface that
/// `WireCloudSyncService` uses. It checks what the sync actually writes to
/// the tables instead of counting calls.

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export class FakeDb {
	readonly tables: Record<string, Row[]> = {
		user: [],
		organization: [],
		member: [],
		team: [],
		teamMember: [],
		externalRef: [],
		account: [],
		externalEvent: [],
	};

	/// How often a table was read or written, for tests that check
	/// "does nothing anymore".
	operations = 0;

	private match(table: string, row: Row, where: Where): boolean {
		return Object.entries(where).every(([key, expected]) => {
			if (expected === undefined) return true;
			if (key === 'team' && table === 'teamMember') {
				const team = this.tables.team.find((t) => t.id === row.teamId);
				return !!team && this.match('team', team, expected as Where);
			}
			// Compound key, e.g. entityType_issuer_externalId
			if (
				key.includes('_') &&
				expected !== null &&
				typeof expected === 'object' &&
				!('in' in (expected as Row))
			) {
				return Object.entries(expected as Row).every(
					([k, v]) => row[k] === v
				);
			}
			const actual = row[key];
			if (
				expected !== null &&
				typeof expected === 'object' &&
				'in' in (expected as Row)
			) {
				return ((expected as { in: unknown[] }).in ?? []).includes(
					actual
				);
			}
			return actual === expected;
		});
	}

	private model(table: string, defaults: () => Row = () => ({})) {
		const rows = this.tables[table];
		const find = (where: Where) =>
			rows.filter((r) => this.match(table, r, where));
		const project = (row: Row | undefined, select?: Row) => {
			if (!row) return null;
			if (!select) return { ...row };
			return Object.fromEntries(
				Object.keys(select).map((key) => [key, row[key]])
			);
		};
		return {
			findUnique: async ({
				where,
				select,
			}: {
				where: Where;
				select?: Row;
			}) => {
				this.operations++;
				return project(find(where)[0], select);
			},
			findFirst: async ({
				where,
				select,
				orderBy,
			}: {
				where: Where;
				select?: Row;
				orderBy?: Record<string, 'asc' | 'desc'>;
			}) => {
				this.operations++;
				const hits = find(where);
				if (orderBy) {
					const [[field, direction]] = Object.entries(orderBy);
					hits.sort(
						(a, b) =>
							(Number(a[field]) - Number(b[field])) *
							(direction === 'desc' ? -1 : 1)
					);
				}
				return project(hits[0], select);
			},
			findMany: async ({
				where = {},
				select,
			}: {
				where?: Where;
				select?: Row;
			}) => {
				this.operations++;
				return find(where).map((row) => project(row, select));
			},
			count: async ({ where = {} }: { where?: Where }) => {
				this.operations++;
				return find(where).length;
			},
			create: async ({ data }: { data: Row }) => {
				this.operations++;
				const row = { id: randomUUID(), ...defaults(), ...data };
				rows.push(row);
				return { ...row };
			},
			update: async ({ where, data }: { where: Where; data: Row }) => {
				this.operations++;
				const row = find(where)[0];
				if (!row) throw new Error('Row not found');
				Object.assign(row, data);
				return { ...row };
			},
			delete: async ({ where }: { where: Where }) => {
				this.operations++;
				const row = find(where)[0];
				if (!row) throw new Error('Row not found');
				rows.splice(rows.indexOf(row), 1);
				return { ...row };
			},
			deleteMany: async ({ where = {} }: { where?: Where }) => {
				this.operations++;
				const hit = find(where);
				for (const row of hit) rows.splice(rows.indexOf(row), 1);
				return { count: hit.length };
			},
		};
	}

	user = this.model('user');
	organization = this.model('organization');
	member = this.model('member');
	team = this.model('team');
	teamMember = this.model('teamMember');
	externalRef = this.model('externalRef');
	account = this.model('account');
	externalEvent = this.model('externalEvent');

	$transaction = async <T>(callback: (tx: FakeDb) => Promise<T>) => {
		// Like the real database: if the callback fails, nothing is left behind.
		const snapshot = structuredClone(this.tables);
		try {
			return await callback(this);
		} catch (error) {
			for (const [name, rows] of Object.entries(snapshot)) {
				this.tables[name].splice(0, this.tables[name].length, ...rows);
			}
			throw error;
		}
	};

	/// Creates a row directly, to prepare a test.
	seed(table: keyof FakeDb['tables'], row: Row): Row {
		const full = { id: randomUUID(), ...row };
		this.tables[table].push(full);
		return full;
	}
}
