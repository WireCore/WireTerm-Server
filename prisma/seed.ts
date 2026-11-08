// Development data: three accounts, a company workspace with a team, projects,
// connections of every type and a snippet — enough to click through the
// desktop client without typing a workspace in by hand.
//
//   docker compose exec wireterm_node sh -c 'cd /var/www/html && npx prisma db seed'
//
// Every account signs in with the password below. The connections carry no
// secrets: those are encrypted by the client, so they ask for a password when
// connecting. Refuses to run in production and in WireCloud mode, and does
// nothing if the accounts already exist.
import { randomUUID } from 'node:crypto';
import { auth } from '../src/lib/auth';
import prisma from '../src/database';
import { nextRevision } from '../src/services/RevisionService';

const PASSWORD = 'wireterm-dev';

const PEOPLE = [
	{
		key: 'anna',
		name: 'Anna Admin',
		email: 'anna@example.test',
		locale: 'de',
	},
	{
		key: 'ben',
		name: 'Ben Builder',
		email: 'ben@example.test',
		locale: 'en',
	},
	{
		key: 'clara',
		name: 'Clara Client',
		email: 'clara@example.test',
		locale: 'en',
	},
] as const;

type Person = (typeof PEOPLE)[number]['key'];

async function signUp(person: (typeof PEOPLE)[number]): Promise<string> {
	const { user } = await auth.api.signUpEmail({
		body: {
			name: person.name,
			email: person.email,
			password: PASSWORD,
			locale: person.locale,
		},
	});
	// The verification mail went to maildev; mark the address as confirmed so
	// that invitations show up right away.
	await prisma.user.update({
		where: { id: user.id },
		data: { emailVerified: true },
	});
	return user.id;
}

async function seedWorkspace(ids: Record<Person, string>) {
	const organization = await auth.api.createOrganization({
		body: { name: 'Example Corp', slug: 'example-corp', userId: ids.anna },
	});
	if (!organization) throw new Error('organization not created');
	const organizationId = organization.id;

	await auth.api.addMember({
		body: { userId: ids.ben, organizationId, role: 'admin' },
	});
	await auth.api.addMember({
		body: { userId: ids.clara, organizationId, role: 'member' },
	});

	const team = await auth.api.createTeam({
		body: { name: 'Operations', organizationId },
	});
	// Adding to a team needs a session in better-auth; written directly, the
	// way the plugin itself stores it.
	await prisma.teamMember.create({
		data: {
			id: randomUUID(),
			teamId: team.id,
			userId: ids.clara,
			membershipKey: `${team.id}:${ids.clara}`,
			createdAt: new Date(),
		},
	});
	await prisma.team.update({
		where: { id: team.id },
		data: { memberCount: 1 },
	});

	await prisma.$transaction(async (tx) => {
		const project = async (name: string, position: number) =>
			tx.project.create({
				data: {
					id: randomUUID(),
					organizationId,
					name,
					position,
					createdById: ids.anna,
					revision: await nextRevision(tx, organizationId),
				},
			});
		const production = await project('Production', 0);
		const staging = await project('Staging', 1);

		// Production goes to the team; Staging stays with owner and admin.
		await tx.projectShare.create({
			data: { projectId: production.id, teamId: team.id, role: 'editor' },
		});

		const connection = async (
			projectId: string,
			name: string,
			position: number,
			settings:
				| { ssh: { host: string; user: string } }
				| { ftp: { host: string; user: string } }
				| { s3: { host: string; user: string; bucket: string } }
		) => {
			const id = randomUUID();
			const type =
				'ssh' in settings ? 'ssh' : 'ftp' in settings ? 'ftp' : 's3';
			await tx.connection.create({
				data: {
					id,
					projectId,
					name,
					type,
					position,
					revision: await nextRevision(tx, organizationId),
				},
			});
			if ('ssh' in settings) {
				await tx.sshConnection.create({
					data: {
						connectionId: id,
						...settings.ssh,
						authSource: 'prompt',
					},
				});
			} else if ('ftp' in settings) {
				await tx.ftpConnection.create({
					data: {
						connectionId: id,
						...settings.ftp,
						authSource: 'prompt',
					},
				});
			} else {
				await tx.s3Connection.create({
					data: {
						connectionId: id,
						...settings.s3,
						authSource: 'prompt',
						region: 'eu-central-1',
					},
				});
			}
		};

		await connection(production.id, 'web01', 0, {
			ssh: { host: 'web01.example.test', user: 'deploy' },
		});
		await connection(production.id, 'db01', 1, {
			ssh: { host: 'db01.example.test', user: 'admin' },
		});
		await connection(production.id, 'Backups', 2, {
			s3: {
				host: 's3.example.test',
				user: 'BACKUPKEYID',
				bucket: 'backups',
			},
		});
		await connection(staging.id, 'web-staging', 0, {
			ssh: { host: 'web.staging.example.test', user: 'deploy' },
		});
		await connection(staging.id, 'Downloads', 1, {
			ftp: { host: 'files.example.test', user: 'upload' },
		});

		await tx.snippet.create({
			data: {
				id: randomUUID(),
				organizationId,
				name: 'Disk usage',
				folder: 'Maintenance',
				command: 'df -h',
				revision: await nextRevision(tx, organizationId),
			},
		});
	});
}

async function main() {
	if (process.env.NODE_ENV === 'production') {
		throw new Error(
			'The seed data is for development, not for production.'
		);
	}
	if (process.env.AUTH_MODE === 'wirecloud') {
		throw new Error(
			'In WireCloud mode accounts come from WireCloud; nothing to seed.'
		);
	}
	if (await prisma.user.findUnique({ where: { email: PEOPLE[0].email } })) {
		console.log('Seed data already present, nothing to do.');
		return;
	}

	const ids = {} as Record<Person, string>;
	for (const person of PEOPLE) ids[person.key] = await signUp(person);
	await seedWorkspace(ids);

	console.log(`Seeded. Sign in with any of these, password "${PASSWORD}":`);
	for (const person of PEOPLE) console.log(`  ${person.email}`);
}

main()
	.then(() => process.exit(0))
	.catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
