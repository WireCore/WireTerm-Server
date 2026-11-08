# Working instructions

## Formatting

Every file you edit or create is formatted with Prettier. The configuration is
in `.prettierrc`, exceptions in `.prettierignore`.

```bash
npx prettier --write <file>
```

Before a task is finished, `npm run format:check` must pass without errors.
`npx eslint . --fix` takes care of that for TypeScript files as well, because
Prettier is wired in there as an ESLint rule.

The script names its paths one by one instead of `.`, because MariaDB's data
directory sits under `db-data/` as a bind mount and belongs to the container.
`.prettierignore` does not help there: Prettier already stumbles while
expanding the directory, before it looks at the ignore list. ESLint looks at it
first, so `eslint .` is enough there.

## Line endings

All files use LF. The rules for that are in `.gitattributes`.

## Environment

The project runs in Docker. npm, the tests and Prisma run inside the
container:

```bash
docker compose exec wireterm_node sh -c 'cd /var/www/html && npm test'
```

The tests need no database — `test/helpers/prisma.ts` and
`test/helpers/auth.ts` replace `src/database.ts` and `src/lib/auth.ts` (see
`alias` in `vitest.config.ts`).

MariaDB has **no port to the outside** — it can only be reached from the
Compose network. Everything that needs the database therefore runs inside the
container as well:

```bash
docker compose exec wireterm_node sh -c 'cd /var/www/html && npx prisma migrate dev'
docker compose exec wireterm_db mariadb -uwireterm -pwireterm wireterm
```

Whoever needs the server on the host opens the port in their own
`docker-compose.override.yml` — see [README.md](README.md#quickstart). The file
is ignored by git and belongs to nobody else.

## What does not belong here

No secret in plain text, and none the server could open. The reason and the
scheme are in [README.md](README.md#encryption); whoever adds a column in which
a password, a private key or a Secret Access Key could end up has come to the
wrong place.

Every user has exactly one personal workspace, and it is an organization like
any other — see [README.md](README.md#personal). Whoever is tempted to
introduce a model of its own for it buys a second permission and sync path;
the change counter hangs off `organization.revision`.

Accounts, organizations and teams come entirely from better-auth. There are no
endpoints of our own for them, and the tables `user`, `session`, `account`,
`verification`, `apikey`, `organization`, `member`, `invitation`, `team` and
`team_member` are those of the `organization` plugin — whatever is changed
about them has to hold up against `npx @better-auth/cli generate`.
