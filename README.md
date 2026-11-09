<p align="center">
    <img src="assets/wireterm.svg" alt="" width="160" height="160" />
</p>

<h1 align="center">WireTerm Server</h1>

<p align="center">
    The sync backend of <a href="https://github.com/WireCore/wireterm">WireTerm</a>: your workspaces on every device and with your team,<br />
    signed in with WireCloud – credentials pass through only as ciphertext.<br />
    Fastify · Prisma on MariaDB · better-auth · Docker image for amd64 and arm64
</p>

<p align="center">
    <a href="#wirecloud-mode"><b>With WireCloud</b></a> ·
    <a href="#self-hosting">Self-hosting</a> ·
    <a href="https://wirecore.github.io/WireTerm-Server/">API reference</a> ·
    <a href="CLIENT.md">Client guide</a> ·
    <a href="#encryption">Encryption</a> ·
    <a href="CONTRIBUTING.md">Contributing</a> ·
    <a href="SECURITY.md">Security</a>
</p>

<p align="center">
    <a href="https://hub.docker.com/r/wirecore/wireterm-server"><img alt="Docker image" src="https://img.shields.io/docker/v/wirecore/wireterm-server?sort=semver&label=docker" /></a>
    <a href="https://github.com/WireCore/wireterm-server/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/WireCore/wireterm-server/actions/workflows/ci.yml/badge.svg?branch=main" /></a>
    <img alt="Languages: English, German" src="https://img.shields.io/badge/mails-EN%20%7C%20DE-blue" />
    <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-green" /></a>
</p>

## About

WireTerm keeps server connections — SSH, SFTP, FTP and S3 — in workspaces.
This server is what makes a workspace available on every device you work on
and shareable with your team: projects, connections, trusted host keys and
snippets stay in sync, while every password and key arrives here already
encrypted by the client. The server cannot read them.

**Most people never run it themselves.** WireTerm signs in with
[WireCloud](https://cloud.wirecore.net), WireCore's platform for accounts,
companies and teams, and syncs to the hosted instance: create a WireCloud
account, choose "Sign in with WireCloud" in the desktop client, and your
workspaces follow you to every device. Who belongs to a company or team, and
who may use WireTerm, is managed in WireCloud.

This repository is for running the server yourself — with WireCloud as the
sign-in ([WireCloud mode](#wirecloud-mode), recommended) or with accounts of
its own (local mode).

### Why WireTerm

WireTerm started because no tool did both: keep connections in sync on its own
when you work on more than one device, and handle S3 next to SSH and SFTP. How
it compares with Termius, electerm, Voltius and FileZilla is in the
[client's README](https://github.com/WireCore/wireterm#how-it-compares).

> **Working on a client?** The [API reference](https://wirecore.github.io/WireTerm-Server/)
> lists every endpoint; [CLIENT.md](CLIENT.md) explains the flows behind them:
> the envelope scheme of the encryption, sync and sharing step by step, and
> the crates a client needs.

## Contents

- [What lives here and what doesn't](#what-lives-here-and-what-doesnt)
- [WireCloud mode](#wirecloud-mode)
- [Quickstart](#quickstart)
- [Accounts, organizations, teams](#accounts-organizations-teams)
- [Who may do what](#who-may-do-what)
- [Encryption](#encryption)
- [Sync](#sync)
- [API](#api)
- [Database and migrations](#database-and-migrations)
- [Tests](#tests)
- [Self-hosting](#self-hosting)
- [Open issues](#open-issues)
- [Contributing](#contributing)
- [License](#license)

## What lives here and what doesn't

Locally the client keeps its tree in a `workspaces.json` in the app's data
directory. This backend answers the same two questions as `workspaces_load` and
`workspaces_save`, only for several devices at once — and therefore no longer
as one document but as a tree of rows that can be changed one at a time.

**What lives here:** who knows whom (accounts, organizations, teams,
invitations), the tree itself (projects, connections and their settings), the
ciphertexts of the secrets, the wrapped keys, the vault accounts and the
trusted host keys.

**What doesn't:** any secret in plain text. No private key, no password, no
Secret Access Key, no master password — not even as a hash. Nothing gets
connected here either: SSH, FTP and S3 are still spoken by the client, the
server only sees the targets as rows in a table.

## WireCloud mode

The way WireTerm is meant to run, and the way the hosted instance runs. With
`AUTH_MODE=wirecloud` nobody signs in to WireTerm itself: a person identifies
with a short-lived token from WireCloud (`Authorization: Bearer ...`), which
the desktop client fetches after "Sign in with WireCloud" in the browser.
Companies, teams and roles come from WireCloud and are kept in step here; the
encryption does not change — WireCloud never sees a secret either.

Without `AUTH_MODE` or with `local` the server keeps accounts, organizations
and invitations of its own, as described in
[Accounts, organizations, teams](#accounts-organizations-teams), and has no
relation to WireCloud.

Against the hosted WireCloud `AUTH_MODE=wirecloud` and `PUBLIC_URL` are all it
takes; everything else follows from fixed paths:

| Variable | Meaning |
| --- | --- |
| `AUTH_MODE` | `local` (default) or `wirecloud` |
| `WIRECLOUD_URL` | WireCloud as clients reach it — the desktop client's sign-in, `wirecloud_url` in the tool description. Default `https://api.cloud.wirecore.net` |
| `WIRECLOUD_ISSUER` | the issuer (`iss`) in WireCloud's tokens; the keys come from `<issuer>/.well-known/jwks.json`. Default `WIRECLOUD_URL`. Only differs in development, where WireCloud is called `http://wirecloud_backend:8080` inside the Docker network but `http://localhost:8200` from the host |
| `WIRECLOUD_AUDIENCE` | this instance's identifier in WireCloud (`aud`). Default `PUBLIC_URL`; only needed if WireCloud lists the instance under another name |

Without an audience (no `PUBLIC_URL` and no `WIRECLOUD_AUDIENCE`) startup
aborts. Tokens may be up to 60 seconds off in time.

- **Verification** is done by `src/lib/wirecloud/`. The module needs only
  `jose` and knows nothing of Fastify, Prisma, better-auth or WireTerm code, so
  it can be reused in other tools. It only accepts EdDSA and checks signature,
  issuer, audience, lifetime, version and the shape of the claims.
- **Sync** is done by `WireCloudSyncService`: on the first call (and on every
  new token) user, organization, membership and teams are created. The mapping
  is kept in `external_ref`. If a company is missing from the token, the person
  loses the membership; "Personal" stays untouched.
- **There is no automatic linking by email.** If the address already exists
  locally, WireTerm answers with 409 (`WC-EC`). A role WireTerm does not know
  results in 403 (`WC-UR`).
- **Events from WireCloud:** `POST /wc/v1/events` accepts revocations, role
  changes, deleted teams and companies, and suspended or deleted accounts
  (admin token `typ: wc-admin`, permission `events:write`, separate from the
  user tokens). They take away **access, never data**: memberships and teams
  disappear, projects and secrets remain. Idempotent via the event `id` and
  ordered via the `sequence` per company or account (table `external_event`).
  `GET /.well-known/wirecloud-tool.json` describes the tool. Both only in
  `wirecloud` mode.
- **Linking an existing local account:** `POST /api/wirecloud/link` with
  `{ "password": "<previous sign-in password>" }` and the WireCloud token. It
  takes both at once: a token with a **verified** address and the local
  account's password. After that the sync maps this account, and it keeps its
  data and keys. Five failed attempts per WireCloud account lock it for 15
  minutes (counted per instance). Answers: `403 WC-LD` (wrong password or
  account already taken), `403 WC-NV` (address in the token not verified),
  `404 WC-NN` (no local account, nothing to do), `429 WC-RL`. The route only
  exists in `wirecloud` mode.
- **Who am I:** `GET /api/wirecloud/me` returns `{ id, name, email }` of the
  local user for the token. The token only knows WireCloud's identifier; keys
  and memberships hang off the local one. The route syncs like any other, so
  an account that is not linked yet results in `409 WC-EC` here too. In local
  mode, `get-session` answers this.
- **`/api/auth/*` does not exist in this mode** (404).
- **Encryption** stays untouched: the master password has nothing to do with
  signing in, and the server can only record grants, not issue them.
- Remembering the most recently synced tokens applies per instance.

## Quickstart

```bash
cp .env.example .env          # and replace BETTER_AUTH_SECRET and COOKIE_SECRET
docker compose up -d
docker compose exec wireterm_node sh -c 'cd /var/www/html && npx prisma migrate deploy'
docker compose exec wireterm_node sh -c 'cd /var/www/html && npx prisma db seed'   # optional
```

This runs in local mode. To develop against a WireCloud running on the same
machine, set `AUTH_MODE=wirecloud`, `WIRECLOUD_URL=http://localhost:8200` and
`WIRECLOUD_ISSUER` to the address under which this container reaches WireCloud
(in a shared Docker network e.g. `http://wirecloud_backend:8080`); WireCloud
has to know the instance under its `PUBLIC_URL`.

The seed (`prisma/seed.ts`) creates development data: three accounts with a
confirmed address — `anna@example.test` (owner, German), `ben@example.test`
(admin) and `clara@example.test` (member of the team "Operations"), all with
the password `wireterm-dev` — and the workspace "Example Corp" with two
projects (only "Production" is shared with the team), SSH, FTP and S3
connections and a snippet in "Production". The connections carry no secrets, since only the
client can encrypt them; they ask for a password when connecting. The seed
refuses to run in production and in WireCloud mode and does nothing a second
time.

Then:

- the API on `http://localhost:8080`
- the Scalar UI on `http://localhost:8080/documentation` (`API_DOCS=true` in
  `.env.example`; off by default)
- phpMyAdmin on `http://localhost:8081`
- maildev on `http://localhost:8082` — catches every mail (verification,
  invitations, password reset) instead of sending it
- MariaDB **only inside the Compose network** — no port to the outside. Look
  into the tables through phpMyAdmin or `docker compose exec wireterm_db mariadb
  -uwireterm -pwireterm wireterm`
- MariaDB's data directory under `db-data/`, as a bind mount

`db-data/` belongs to the container (uid 999) and cannot be read from outside.
That is why `npm run format:check` names its paths one by one instead of
pointing Prettier at `.` — see [CLAUDE.md](CLAUDE.md#formatting).

Everything that needs the database — `prisma migrate`, `prisma studio`, the
tests — therefore runs inside the container:

```bash
docker compose exec wireterm_node sh -c 'cd /var/www/html && npx prisma migrate dev'
```

If you would rather run the server on the host, create a
`docker-compose.override.yml` (ignored by git) and open the port for yourself:

```yaml
services:
    wireterm_db:
        ports:
            - 3307:3306
```

```bash
npm install
DATABASE_URL=mysql://wireterm:wireterm@127.0.0.1:3307/wireterm npm run dev
```

## Accounts, organizations, teams

In [WireCloud mode](#wirecloud-mode) these rows are filled from WireCloud: a
company there is an organization here, its teams are teams, and nobody signs
up, invites or creates organizations on this server. What follows describes
local mode, where the server manages them itself.

All of this comes from better-auth; there are no endpoints of our own for it.
The tables `user`, `session`, `account`, `verification`, `apikey`,
`organization`, `member`, `invitation`, `team` and `team_member` in
`prisma/schema.prisma` are the ones the `organization` plugin expects with
`teams: { enabled: true }`.

**An organization is a workspace.** What the client shows in its sidebar is
the list of organizations someone is a member of. Whoever wants several
separate workspaces creates several organizations — there is no upper limit.

### "Personal"

The word "organization" is none of a private user's business, and the app's
first question should not be "What is your organization called?". So sign-up
creates an organization that belongs to the new user alone:

- created in the hook `databaseHooks.user.create.after` via
  `auth.api.createOrganization` with `userId` and without headers — the way the
  plugin provides for calls by the server itself. Organization and membership
  are created in one go.
- named `Personal` or `Persönlich`, depending on the account's language (see
  [Language](#language)), slug `personal-<userId>`. A slug derived from the
  name would let two people with the same name spoil each other's sign-up.
- marked in `organization.metadata` as `{"kind":"personal"}`. The column
  exists anyway, so this costs no migration.
- `GET /api/workspaces` and `…/sync` return `kind`, so the client knows where
  to show "Manage members" and where not.

Technically it is an organization like any other, with one member in the role
`owner`. **That is the point:** sync, permissions and encryption need no
second path, and "private" becomes "team" by inviting someone — without a move
and without a switch. Whoever wants to keep private and work apart creates an
ordinary organization next to it; the client shows both in the sidebar.

It cannot be deleted (`organizationHooks.beforeDeleteOrganization` answers
with `PERSONAL_WORKSPACE_NOT_DELETABLE`). Otherwise someone would be left
without any workspace after one click, and a second one would never be created
— the sign-up that creates it is long over. Renaming works.

The way in from outside:

| Purpose | Endpoint |
| --- | --- |
| Sign up | `POST /api/auth/sign-up/email` |
| Resend verification mail | `POST /api/auth/send-verification-email` |
| Sign in | `POST /api/auth/sign-in/email` |
| Create a workspace | `POST /api/auth/organization/create` |
| Invite someone | `POST /api/auth/organization/invite-member` |
| Create a team | `POST /api/auth/organization/create-team` |
| Add someone to a team | `POST /api/auth/organization/add-team-member` |

Creating an organization creates no team (`defaultTeam` is switched off). For
all members there is the share with the whole organization; create teams only
when you really need groups. Invitations go out by mail and therefore need
SMTP — without `SMTP_*` set, `invite-member` fails.

The plugin hands out one's own pending invitations (`list-user-invitations`)
only to accounts with a verified email address, and that check cannot be
switched off. So sign-up sends a verification mail along; its link points
directly at this backend's `/api/auth/verify-email`.
Signing in works unverified. If the mail fails during sign-up, the account is
created anyway, and the mail can be requested again via
`send-verification-email`.

The desktop client has no browser and thus no cookie jar that outlives it. For
it there are personal API keys (`user_…`), sent as the `x-api-key` header, with
the same rights as a session.

### Language

Every account has a `locale` (`en` or `de`, a better-auth `additionalField`,
see `src/lib/locale.ts`). It decides the language of the mails and the name of
the personal workspace.

- **At sign-up** it comes from `locale` in the body if that is a supported
  language, otherwise from the first supported language in `Accept-Language`,
  otherwise `en`. `de-DE` and `de_AT` count as `de`.
- **Later** the client changes it with `POST /api/auth/update-user`
  `{ "locale": "de" }`. An unsupported value is dropped, not stored. The name
  of the personal workspace stays as it was — it is only a default.
- **Verification and password mails** go out in the account's language.
- **Invitations** go out in the language of the invited account if the
  address already has one, otherwise in the language of the request that sent
  the invitation (`Accept-Language`).

The templates live in `src/templates/mail/<kind>/<locale>.njk`, the subjects
in `src/lib/mails.ts`. A new language needs an entry in `LOCALES`, a template
per mail, a subject per mail and a name in `PERSONAL_NAMES`
(`src/services/WorkspaceService.ts`).

## Who may do what

Two levels, and they answer different questions.

**The role in the organization** (`owner`, `admin`, `member`) decides about
the workspace: creating and deleting projects, managing shares, setting vault
accounts. `owner` and `admin` also see every project of the organization
without needing a share.

**The share** (`project_share`) decides for everyone else which projects exist
for them at all. A share points at a team — or, with an empty `teamId`, at the
whole organization — and grants `editor` or `viewer`.

A project that is not shared answers with **404, not 403**: that a project of
that name exists is itself information.

Any member may add and remove trusted host keys. That is deliberately
generous: whoever finds a wrong entry should get rid of it without hunting for
an administrator — and whatever is listed there has been confirmed by a human
in the client anyway.

## Encryption

The part the client has to build. The server gets nothing out of it but bytes.

### Two passwords, and why

| | Sign-in password | Master password |
| --- | --- | --- |
| for | signing in to the server | opening the secrets |
| stored | as a hash in `account.password` | nowhere |
| who can reset it | the server, by mail | nobody — that is what the recovery codes are for |

If the two were the same, the server could read along at sign-in with what the
secrets are wrapped with — and the encryption would be a ritual. So two.

### A user's key pair

On setup the client generates an X25519 pair:

1. `masterKey = Argon2id(master password, kdfSalt, kdfParams)`
2. The private key is wrapped with `masterKey` (XChaCha20-Poly1305).
3. `POST /api/keys/me` sends the **public** key in plain text and the
   **private** one as ciphertext along with salt and KDF parameters.

The parameters travel along so they can be raised later without locking out
existing accounts: whoever signs in computes with what is in their row.

`POST /api/keys/me` works **exactly once**. A second call answers with 409, and
that is not protection against typos but against data loss: every project key
of this user is wrapped to the old public key and could not be opened with a
new pair.

A **new master password** is therefore not a new pair but a new wrapping of
the same one: `POST /api/keys/me/rewrap`.

### Recovery codes

On setup the client also generates a set of codes — about eight, each around
120 bits, written in groups:

```
WT7K-4M2P-9XQD-R3FV-8HLN-2JWC
```

For each code the same private key is wrapped once more, under
`Argon2id(code, its own salt)`. The rows end up in `recovery_key`.

**The code itself is stored nowhere** — not even as a hash. A hash would be an
attack surface for exactly the database that is not supposed to be able to
read anything here. It is recognized by its `label`: the **first group in
plain text**, so the client finds the matching row without trying all eight
Argon2id runs. That gives away 20 of the 120 bits; the remaining 100 carry it.

The way back after losing the master password:

1. Sign in normally — the sign-in password is a different one and still works.
2. `GET /api/keys/me` fetches the ciphertexts.
3. Enter the code, find the matching `recovery_key` row by its label, unwrap
   the private key.
4. Set a new master password, wrap the private key with it, generate a **new
   set of codes** and upload both with `POST /api/keys/me/rewrap`.

Step 4 replaces the old set completely — the old one opens the same door.

### Project keys

A project has a symmetric key. The secrets in it are wrapped with that key;
the key in turn is stored once per entitled user, wrapped, in `project_key`:

```
secret      --XChaCha20-Poly1305(project key)-->  secret.ciphertext
project key --X25519 to the public key-->         project_key.wrappedKey
```

From this follows the most important sentence about this backend: **the server
can record a grant, but cannot issue one.** Only someone who already has the
key can wrap it — that is, a client of an existing member.

What happens when someone joins a team:

1. The administrator shares the project (`PUT …/shares`). From now on the
   newcomer sees the rows — names, hosts, user names — but the ciphertexts
   remain bytes to them.
2. A client that has the project key asks `GET …/key-requests`. The answer
   names every entitled user, their public key and the versions they already
   hold.
3. It wraps the project key for those missing and sends the result to
   `POST …/keys`.

Whoever has not set up a master password yet comes back in step 2 with
`key: null` — nothing can be wrapped for them, and that is not an error but
information for the UI.

### What the scheme does not do

- **A revocation does not take back knowledge.** Whoever loses the share loses
  their wrapped copy (`PUT …/shares` clears it away), but what they have read
  until then they still know. It is only truly sealed once the client creates
  a **new version** of the project key and rewraps the secrets with it — that
  is what `keyId` is for. The desktop client does that on request (Shares →
  "Renew key") and offers it after a member is removed — for the projects that
  `GET …/members/:user/stale-keys` lists — but not on its own. A new version
  also clears away the copies held by someone who may no longer see the
  project. So the client recognizes the new version as the current one, the
  sync returns the project keys sorted by `createdAt`.
- **The metadata is readable.** Host, port, user name, project and connection
  name are in plain text in the database. Whoever has them has a map of the
  infrastructure, though no keys. That was a deliberate decision: the server
  should be able to sort, count and sync field by field.
- **`owner` and `admin` see every project.** Not every secret — for that they
  would need a project key — but every row.
- **The client is all of the security.** Argon2id, XChaCha20-Poly1305 and
  X25519 are not in this repository. A sloppy client makes every row here
  worthless.
- **TLS protects the wire**, not this backend. It speaks HTTP; the reverse
  proxy in front of it turns that into HTTPS. Without one, session cookies and
  API keys travel in plain text — the ciphertexts, however, stay ciphertexts.

## Sync

`workspaces_load` loads the whole document. That works for a file on a disk;
over a wire with several devices attached, it no longer does.

Instead, every organization keeps a **change counter** (`revision`, BIGINT).
Every row written gets the value the counter had at that moment.
`GET /api/workspaces/:id/sync?since=N` returns everything that has happened
since, along with the new value.

```
GET …/sync?since=0    → everything this user may see
GET …/sync?since=17   → only what came after
```

Three things matter here:

**Tombstones.** Nothing is deleted; `deletedAt` is set and the revision
raised. A device that has been offline since the deletion would otherwise
never learn of it. For secrets the bytes go anyway — a tombstone says the
secret no longer exists and does not have to keep it for that.

**Two lists are not a delta.** `projectKeys` and `shares` always come
complete. Both are a handful of rows, and a key that does not come along
because `since` is too high makes a project unreadable for no reason.

**Revisions travel as strings.** `JSON.stringify` throws on a BigInt, and a
number would be wrong from 2^53 on.

Against concurrent changes there is optimistic locking: whoever sends
`expectedRevision` and is off gets **409** instead of a silent overwrite.
Whoever leaves the field out gets the old behavior, where the last writer
wins.

## API

The full reference — every endpoint with its parameters, including
better-auth's under `/api/auth` — is generated from the code and published at
**[wirecore.github.io/WireTerm-Server](https://wirecore.github.io/WireTerm-Server/)**.
A running server shows the same under `/documentation` with `API_DOCS=true`,
and `npm run openapi` writes the OpenAPI description to a file. Tag and summary
of each route live in `src/config/apiDocs.ts`; a test fails when a route is
missing there.

What the endpoints mean together — the encryption, the sync, sharing and key
handover — is in [CLIENT.md](CLIENT.md). Errors come as
`{ "code": "…", "detail": "…" }`; the codes are in `src/utils/ErrorCodes.ts`.

### Pages for the links in mails

Two mails carry a link that a person opens in a browser: the password reset
and the invitation to a workspace. The desktop client registers no URL scheme
of its own, so the server answers these links itself, with plain HTML pages in
the browser's language (English or German, by `Accept-Language`):

- `/reset-password/<token>` is a form for the new sign-in password. It calls
  better-auth's `resetPassword` on the server side; the token works once and
  expires after an hour. The master password is not affected — the page says
  so, like the mail.
- `/organization/acceptinvite/<id>` shows the link to paste into WireTerm under
  "Add workspace". Accepting happens in the client, signed in with the
  invited account.

Both exist only in local mode. A web frontend of one's own that serves these
paths can take over: `APP_LINK_BASE` then points the links in mails there
instead of to `PUBLIC_URL`.

### Rate limiting

Each address may make `RATE_LIMIT_MAX` requests per minute (default 600), after
that the server answers with `429` and `RL`. `/health` is exempt. better-auth
additionally throttles sign-in, sign-up and the mail endpoints: three attempts
per ten seconds or per minute, respectively.

Which address counts is decided by `TRUST_PROXY`. Without a value it is the
connection's — right when the server faces the network directly. Behind a
reverse proxy it should be `1` (or the number of hops), otherwise all clients
share the proxy's address and with it one counter. An `X-Forwarded-For` that a
client sends itself does not reach better-auth: the route sets the header from
the address Fastify determined.

## Database and migrations

```bash
npx prisma migrate dev --name what_changes   # development
npx prisma migrate deploy                    # production
npx prisma generate                          # client + ERD.md
```

`ERD.md` is regenerated on every `generate` and must not be edited by hand.

The indexes of the better-auth tables are declared **without** a prefix length
(`@@index([userId])` instead of `@@index([userId(length: 191)])`), except on
`@db.Text` columns. On a `VARCHAR(191)` a prefix of 191 characters is the same
as no prefix — but Prisma sees it as a different index from the one the
foreign key creates anyway, and reports a drift on every `migrate dev` that is
none.

## Tests

```bash
npm test                      # vitest with coverage
npx vitest run test/routes    # only the routes
npm run lint                  # eslint, with type-aware rules, also over the tests
npm run typecheck             # tsc over src, test, prisma and the config files
npm run format:check          # prettier
```

`tsconfig.json` covers everything that is checked; the build compiles only
`src/` through `tsconfig.build.json`.

In the Compose setup these run inside the container, e.g.
`docker compose exec wireterm_node sh -c 'cd /var/www/html && npm test'`.

The tests need no database: `test/helpers/prisma.ts` and `test/helpers/auth.ts`
replace `src/database.ts` and `src/lib/auth.ts` (see `alias` in
`vitest.config.ts`). What is tested above all is what may go wrong and what
may not — that a viewer cannot replace a secret, that a second key pair is
rejected, that a share that disappears takes the wrapped copies with it.

## Self-hosting

There are two ways to run your own instance:

- **With WireCloud (recommended).** People sign in with their WireCloud
  account; companies, teams and access are managed there. Set
  `AUTH_MODE=wirecloud` and `PUBLIC_URL` — the defaults point to the hosted
  WireCloud — and have the instance registered in WireCloud with its
  `PUBLIC_URL` as identifier. See [WireCloud mode](#wirecloud-mode).
- **Local mode.** The server keeps accounts, organizations and invitations of
  its own. It then needs SMTP for verification mails, invitations and password
  resets.

Everything else — database, secrets, reverse proxy — is the same for both.

### The image

Every release is published as a container image:

- `wirecore/wireterm-server` on Docker Hub
- `ghcr.io/wirecore/wireterm-server`

with the tags `X.Y.Z`, `X.Y`, `X` and `latest`. The image is built from
`.docker/prod/Dockerfile`, runs as the unprivileged user `node`, listens on
port 80 and contains the Prisma CLI, its engine and the migrations, so
`npx prisma migrate deploy` runs from the image itself without downloading
anything.

### With Docker Compose

`docker-compose.prod.yml` at the root of the repository is a complete example:
MariaDB with its own volume, and the server, which applies pending migrations
with `npx prisma migrate deploy` on every start before it starts listening. A
failed migration therefore stops the start instead of running a server against
a schema it does not know.

```bash
cp .env.example .env
echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
echo "DB_ROOT_PASSWORD=$(openssl rand -hex 24)" >> .env
docker compose -f docker-compose.prod.yml up -d
```

`.env.example` is set up for development. Change at least `PUBLIC_URL`,
`BETTER_AUTH_SECRET`, `COOKIE_SECRET`, `CORS_ORIGIN` and
`BETTER_AUTH_TRUSTED_ORIGINS` (empty when only the desktop client connects),
`BETTER_AUTH_COOKIE_DOMAIN` (empty), `BETTER_AUTH_DISABLE_ORIGIN_CHECK=0`,
`SMTP_*` and `SMTP_FROM`.

`DB_PASSWORD` and `DB_ROOT_PASSWORD` only set up the database container; the
compose file builds the server's `DATABASE_URL` from them. The server's port is
published only on `127.0.0.1:8080`, for a reverse proxy on the same host.

MariaDB only takes its passwords from the environment when the volume is
initialized for the first time; to change one later, change it in the
database as well:

```bash
docker compose -f docker-compose.prod.yml exec db mariadb -uroot -p \
  -e "ALTER USER 'wireterm'@'%' IDENTIFIED BY '<new password>';"
docker compose -f docker-compose.prod.yml restart server
```

### Behind a reverse proxy

The server speaks plain HTTP. Put a reverse proxy with TLS in front of it
(nginx, Caddy, Traefik, …) and do not expose the server's port to the internet:
without TLS, session cookies and API keys travel in plain text.

Behind exactly one proxy set `TRUST_PROXY=1`, otherwise the rate limit sees
every client as the proxy's address (see [Rate limiting](#rate-limiting)).
`PUBLIC_URL` is the public HTTPS address of the backend, since the
verification links and the pages for reset and invitation live there.

`/health` answers `{"status":"ok"}` as soon as the server accepts requests;
use it for health checks.

### Environment variables

Secrets marked _FILE_ can also be read from a file: set `<NAME>_FILE` to its
path (Docker and Kubernetes secrets), e.g. `BETTER_AUTH_SECRET_FILE=/run/secrets/auth`.
The file's surrounding whitespace is dropped.

| Variable | Required | Meaning |
| --- | --- | --- |
| **Server** | | |
| `SERVER_HOST` | no | address to listen on, default `0.0.0.0` |
| `SERVER_PORT` | no | port to listen on, default `80` |
| `LOG_LEVEL` | no | `fatal`, `error`, `warn`, `info` (default; logs every request), `debug`, `trace` or `silent` |
| `API_DOCS` | no | `true` serves the API documentation under `/documentation`. Off by default: it describes every endpoint to whoever asks |
| `TRUST_PROXY` | behind a proxy | who may set `X-Forwarded-For`: empty for nobody, `1` (or a number of hops), `true`, or addresses/networks, comma-separated |
| `RATE_LIMIT_MAX` | no | requests per minute and address, default `600` |
| **Database** | | |
| `DATABASE_URL` | yes, _FILE_ | `mysql://user:password@host:3306/name`, the only connection setting — the server and `prisma migrate` both use it. Percent-encode special characters in the password |
| `DATABASE_SSL` | no | `true` connects over TLS and verifies the certificate (for the server and for migrations) |
| `DATABASE_SSL_CA` | no | path to a CA certificate (PEM) for a database whose CA is not in the system store, e.g. Amazon RDS |
| `DATABASE_CONNECTION_LIMIT` | no | size of the connection pool, default `5` |
| **Accounts** | | |
| `PUBLIC_URL` | yes | public address of the backend, e.g. `https://wireterm.example.com`; links in mails and the pages for reset and invitation live there |
| `BETTER_AUTH_SECRET` | yes, _FILE_ | better-auth's secret, at least 32 random characters |
| `COOKIE_SECRET` | yes, _FILE_ | secret for signing cookies |
| `CORS_ORIGIN` | no | browser origins allowed to call the API, comma-separated. Unset: none — enough for the desktop client, which sends no `Origin`; a web frontend has to be listed |
| `BETTER_AUTH_TRUSTED_ORIGINS` | no | origins better-auth accepts for cookie requests and callback URLs, comma-separated; defaults to `CORS_ORIGIN` |
| `BETTER_AUTH_COOKIE_DOMAIN` | no | domain for the session cookie, to share it across subdomains. Unset: the cookie belongs to this host only |
| `BETTER_AUTH_DISABLE_SIGNUP` | no | `1` closes self-service sign-up (`sign-up/email`) |
| `BETTER_AUTH_DISABLE_ORIGIN_CHECK` | no | `1` switches off better-auth's origin, callback URL and CSRF checks. For development only |
| `APP_LINK_BASE` | no | only for a web frontend of your own: links in mails then point there instead of to this server's [pages](#pages-for-the-links-in-mails) |
| **Mail** | | |
| `SMTP_HOST` | for mails | mail server; without it there are no verification mails, invitations or password links |
| `SMTP_PORT` | no | default `587` |
| `SMTP_SECURE` | no | `true` for TLS from the first byte (port 465), `false` for STARTTLS. Unset: `true` on port 465, else `false` |
| `SMTP_USERNAME` | no | user at the mail server; no authentication without it |
| `SMTP_PASSWORD` | no, _FILE_ | its password |
| `SMTP_FROM` | recommended | sender, e.g. `WireTerm <noreply@example.com>`. Unset: `SMTP_USERNAME`, which with many providers (SendGrid, SES, Mailgun) is not an address |
| `SMTP_TLS_SERVERNAME` | no | host name to check the server's certificate against, if it differs from `SMTP_HOST` |
| **Telemetry** | | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | OTLP/gRPC collector for traces and logs. Unset: telemetry is off |
| `OTEL_SERVICE_NAME` | no | service name, default `wireterm-backend` |
| `OTEL_RESOURCE_ATTRIBUTES` | no | further OpenTelemetry resource attributes, e.g. `deployment.environment.name=production` |
| **WireCloud mode** | | |
| `AUTH_MODE` | no | `local` (default) or `wirecloud`, see [WireCloud mode](#wirecloud-mode) |
| `WIRECLOUD_URL`, `WIRECLOUD_ISSUER`, `WIRECLOUD_AUDIENCE` | no | see [WireCloud mode](#wirecloud-mode); against the hosted WireCloud none of them is needed |

The server refuses to start in local mode without `PUBLIC_URL`,
`BETTER_AUTH_SECRET` and `COOKIE_SECRET`, and in WireCloud mode without
`PUBLIC_URL` (or `WIRECLOUD_AUDIENCE`).

## Open issues

- **Invitations need SMTP.** Without `SMTP_*`, `invite-member` fails. A way to
  add someone directly would be more convenient for small installations.
- **The ciphertexts go to everyone who may see the project** — including
  someone who has no key for it yet. That is intended (they need them locally
  as soon as they get one), but it is more than necessary.
- **Existing users without a personal workspace.** Whoever was created before
  this hook — or by a path that does not trigger it — has none.
  `ensurePersonalWorkspace` is idempotent and could be run once over all users
  for such a case; there is deliberately no repair path at runtime.
- **The rate limit counts per process.** With several replicas each has its
  own counter; a shared store (Redis) would be the next step.
- **The data of a company deleted in WireCloud stays forever.** `org.deleted`
  removes the memberships and teams only; projects, connections and secrets
  stay on the server with nobody left to reach them. That is right for access
  taken away or a subscription ended — both can come back — but not for a
  company that is gone for good, and it keeps connection data of a former
  customer indefinitely. To decide: delete on `org.deleted` right away or
  after a grace period (then with a cleanup job), and change the contract
  with WireCloud ("access, never data") on both sides accordingly. Deleting
  an organization's workspace from the client is deliberately not planned:
  while the company exists at WireCloud, the next sign-in would recreate it
  empty.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
Please report security vulnerabilities privately as described in
[SECURITY.md](SECURITY.md), not in a public issue.

## License

[AGPL-3.0-only](LICENSE). Whoever runs a modified version of this server for
others has to offer them its source code.
