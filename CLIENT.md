# WireTerm Backend — what the client has to build

The counterpart to `StorageKind::Cloud` in the desktop client's
`src-tauri/src/storage.rs`. Everything here is taken from the running
implementation and has been played through against a real database — not a
statement of intent.

The backend side itself is described in [README.md](README.md); this document
repeats only what the client needs to know from it, and adds what the client
has to decide for itself.

## Contents

- [The structure in one picture](#the-structure-in-one-picture)
- [Organization, team, project](#organization-team-project)
- [Encryption](#encryption)
- [The flows](#the-flows)
- [Sync](#sync)
- [Endpoints](#endpoints)
- [What the client has to bring](#what-the-client-has-to-bring)
- [What is still missing](#what-is-still-missing)

## The structure in one picture

```
User ──member of──▶ Organization  ( = workspace, what workspaces.json is locally )
 │                          │
 │                          ├── Team ────┐
 │                          │            │ share (editor|viewer)
 │                          │            ▼
 └──member of────────────── Team ──▶ Project ──▶ Connection ──▶ Secret (ciphertext)
                                        │
                                        └──▶ ProjectKey  (the project key,
                                              wrapped once per entitled user)

The organization also carries:  VaultAccount (1Password/Bitwarden), KnownHostKey, Snippet
```

A user sees **one row per organization** they are a member of in the sidebar.
That is exactly the list `workspaces_load` reads from the local file.

## Organization, team, project

### Organization = workspace

There is no workspace model of its own. An organization **is** the workspace.
Accounts, organizations, teams and invitations come entirely from
[better-auth](https://better-auth.com/docs/plugins/organization#teams) and go
through `/api/auth/*`.

### "Personal"

Sign-up automatically creates an organization that belongs to the new user
alone — named `Personal` or `Persönlich` depending on the account's language,
slug `personal-<userId>`, one member in the role `owner`, no team.

`GET /api/workspaces` returns `kind: "personal"` for it, `kind:
"organization"` for everything else. The client should show **no** "Manage
members" and **no** "Delete" on it — the server refuses to delete it anyway
(`PERSONAL_WORKSPACE_NOT_DELETABLE`). Renaming works.

Inviting people into the personal workspace is allowed. That is exactly how it
becomes a team: no move function, no switch. Whoever wants to keep private and
work apart creates an ordinary organization next to it — any number are
allowed.

### Language

Every account has a `locale`, `en` or `de`. It decides the language of the
mails (verification, password reset, invitation) and the name of the personal
workspace at sign-up.

- Send it along at sign-up: `POST /api/auth/sign-up/email` with `locale`.
  Without it the server takes the first supported language from
  `Accept-Language`, then `en`.
- Change it with `POST /api/auth/update-user` `{ "locale": "de" }`. An
  unsupported value is silently dropped. The personal workspace keeps its
  name.
- An invitation goes out in the language of the invited account if the
  address already has one, otherwise in the language of the inviting request —
  so send `Accept-Language` with `invite-member`.

### Roles

Two levels that answer different questions.

**Role in the organization** (`owner`, `admin`, `member`) — comes from
better-auth:

|                         | owner / admin | member      |
| ----------------------- | ------------- | ----------- |
| Create, delete projects | yes           | no (403)    |
| Manage shares           | yes           | no (403)    |
| Set vault accounts      | yes           | no (403)    |
| Create, change snippets | yes           | no (403)    |
| See projects            | **all**       | only shared |
| Add/remove host keys    | yes           | yes         |

**Share** (`ProjectShare`) — decides for `member` which projects exist at all.
It points at a team, or with `teamId: null` at the whole organization, and
grants `editor` or `viewer`.

> A project without a share answers with **404, not 403**. That a project of
> that name exists is itself information. The client should not turn this into
> a "no permission" error message.

**Important:** role and share only govern which _rows_ someone gets. Even an
`owner` only gets at the secrets once someone has wrapped the project key for
them — see below. The server cannot do that.

## Encryption

### Two passwords, and why

|              | Sign-in password         | Master password                          |
| ------------ | ------------------------ | ---------------------------------------- |
| for          | signing in to the server | opening the secrets                      |
| stored       | as a hash on the server  | **nowhere**, not even as a hash          |
| can be reset | yes, by mail             | no — that is what recovery codes are for |

If the two were the same, the server could read along at sign-in with what the
secrets are wrapped with. The client has to ask for them separately and **must
never send the master password anywhere**.

### The envelope scheme

The most common mistake: the secret is **not** encrypted with your own public
key. Then nobody but you could ever read it. There are two layers in between:

```
Secret        ──encrypted with──▶  project key PK      (symmetric, 32 bytes,
                                                        one per project)
Project key   ──wrapped with────▶  public key           (asymmetric,
                                    of each entitled     one per person)
                                    user
```

The secret is encrypted **once**. Only `PK` — 32 bytes — is wrapped once per
person.

```
                    ┌──────────────── YOUR CLIENT ────────────────┐
                    │                                             │
  master password ─▶│ Argon2id ──▶ masterKey                      │
                    │                  │                          │
                    │                  ▼                          │
                    │       private key (X25519)                  │
                    │                                             │
                    │  project key PK  (generated in the client)  │
                    │       │                    │                │
   "hunter2" ───────┼──▶ XChaCha20 ◀─────────────┘                │
                    │       │                                     │
                    └───────┼─────────────────────────────────────┘
                            ▼
        ╔═══════════════ SERVER ═══════════════════════════════════╗
        ║  secret        keyId="k1"  nonce  ciphertext             ║
        ║                                   ↑ just bytes           ║
        ║  project_key   projectId  userId  keyId  wrappedKey      ║
        ║                proj-1     YOU     k1     PK for you      ║
        ║                proj-1     ANNA    k1     PK for Anna     ║ ◀── the step
        ║  user_key      userId  publicKey  encryptedPrivateKey    ║
        ╚══════════════════════════════════════════════════════════╝
                            │
                            ▼
                    ┌─────────────── ANNA'S CLIENT ───────────────┐
  master password ─▶│ Argon2id ──▶ masterKey                      │
                    │                  ▼                          │
                    │       Anna's private key                    │
                    │                  ▼                          │
                    │    wrappedKey ──unwrap──▶ PK                │
                    │                            │                │
                    │    ciphertext ──decrypt────┘                │
                    │                  ▼                          │
                    │              "hunter2"                      │
                    └─────────────────────────────────────────────┘
```

**The sentence that matters:** the server can _record_ a grant, but cannot
_issue_ one. Only someone who already has `PK` can wrap it — that is, a client.

### The algorithms in detail

The names are stored as text in the database (`algorithm`, `wrapAlgorithm`,
`kdf`) so they can be changed later. For "v1":

**User key pair** — X25519.

**Master password → key:**

```
masterKey = Argon2id(password, salt = kdfSalt, params = kdfParams)   → 32 bytes
```

`kdfParams` is a JSON string, recommended `{"m":65536,"t":3,"p":4}` (64 MiB,
3 passes, 4 lanes). The parameters travel **along** so they can be raised
without locking out existing accounts: at sign-in, compute with what is in the
row — never with a constant hard-coded in the client.

**Wrapping the private key:**

```
nonce               = 24 random bytes
encryptedPrivateKey = XChaCha20Poly1305(masterKey, nonce).encrypt(privKey)
```

**Wrapping the project key for someone** (`x25519-xchacha20poly1305`):

```
(esk, epk) = generate X25519                       // ephemeral pair, single use
shared     = X25519(esk, recipient_publicKey)
wrapKey    = HKDF-SHA256(ikm = shared,
                         info = "wireterm/project-key/v1" || epk || recipient_publicKey)
nonce      = 24 random bytes
wrappedKey = XChaCha20Poly1305(wrapKey, nonce).encrypt(PK)

upload: { ephemeralPublicKey: epk, nonce, wrappedKey }
```

Unwrapping is the same in reverse: `shared = X25519(own_privKey, epk)`, same
HKDF, decrypt. `epk` and the recipient's key belong in `info` so the result is
bound to exactly these two parties.

**Encrypting a secret:**

```
nonce      = 24 random bytes
ciphertext = XChaCha20Poly1305(PK, nonce).encrypt(secret, aad = connectionId)
```

> **Recommendation on the `aad`:** passing the `connectionId` as additional
> authenticated data costs one line and prevents a manipulated server from
> moving a ciphertext from one connection to another. It has to be fixed from
> the start — introducing it later would mean re-encrypting everything. The
> backend does not store the `aad`; it follows from the context.

### Recovery codes

On setup the client generates a set of codes — eight recommended. Each wraps
**the same private key** once more, under `Argon2id(code, its own salt)`.

Recommended format: 6 groups of 4 characters from Crockford Base32 (without I,
L, O, U), so 120 bits:

```
WT7K-4M2P-9XQD-R3FV-8HLN-2JWC
```

Normalize before deriving: upper case, remove hyphens and spaces.

**The code is stored nowhere** — not even as a hash. A hash would be an attack
surface for exactly the database that is not supposed to be able to read
anything. It is recognized by its `label`: the **first group in plain text**,
so the client finds the matching row instead of trying eight Argon2id runs.
That gives away 20 of the 120 bits; the remaining 100 carry it.

## The flows

### 1. Sign-up and setup

```
POST /api/auth/sign-up/email      { email, password, name, locale? }
   → the server creates "Personal" on the side
   → and sends a mail with the link to verify the address

   client asks for a master password
   client generates an X25519 pair and eight recovery codes
   client shows the codes ONCE and urges the user to write them down

POST /api/keys/me                 { algorithm?, publicKey, master, recoveryKeys }
```

`POST /api/keys/me` works **exactly once**. A second call answers `409 K-EX`,
and that is not protection against typos but against data loss: every project
key of this user is wrapped to the old public key.

### 2. Sign-in on a new device

```
POST /api/auth/sign-in/email      { email, password }
GET  /api/keys/me                 → publicKey, master{…}, recoveryKeys[]
   ask for the master password
   masterKey = Argon2id(password, master.kdfSalt, master.kdfParams)
   privKey   = decrypt(master.encryptedPrivateKey)
   → keep in memory only, never on disk
GET  /api/workspaces
GET  /api/workspaces/:org/sync?since=0
```

If the master password is wrong, decryption fails — the server notices nothing
and cannot check it either.

### 3. Forgotten master password

```
POST /api/auth/sign-in/email      ← the sign-in password is a different one, still works
GET  /api/keys/me                 → recoveryKeys[] with label
   enter code, normalize, first group = label → matching row
   recoveryKey = Argon2id(code, row.kdfSalt, row.kdfParams)
   privKey     = decrypt(row.encryptedPrivateKey)

   ask for a new master password, rewrap privKey
   generate a NEW set of codes  ← the old one opens the same door

POST /api/keys/me/rewrap          { master, recoveryKeys }
POST /api/keys/me/recovery/:id/used
```

`rewrap` replaces the set completely when `recoveryKeys` comes along. The key
pair stays the same — only the wrapping is new, and so all project keys stay
valid.

### 4. Changing the master password

The same `rewrap`, except that `privKey` comes from the old master password
instead of a code.

### 5. Creating a project and storing the first secret

```
POST /api/workspaces/:org/projects            { id, name, position? }
   client generates PK (32 random bytes) and a keyId (e.g. a UUID)
   client wraps PK for itself
POST …/projects/:id/keys                      { keyId, grants:[{userId: me, …}] }

POST …/projects/:id/connections               { id, name, type, ssh|ftp|s3 }
   client encrypts the secret with PK
PUT  …/connections/:id/secret                 { keyId, nonce, ciphertext }
```

Mind the order: the server rejects a `secret` with an unknown `keyId` (`400`),
because a ciphertext nobody can open would be silent data loss.

The `id` of project, connection and snippet comes **from the client**. It
also creates things offline, and renumbering on upload would drag every
connection below along. It has to be a lower-case UUID, otherwise `400`: the
IDs are unique server-wide, not per workspace, and a meaningful ID could
already be taken by another workspace.

### 6. Inviting someone and sharing a project

```
POST /api/auth/organization/invite-member     { email, role, organizationId?, teamId? }
POST /api/auth/organization/create-team       { name, organizationId }
POST /api/auth/organization/add-team-member   { teamId, userId }

PUT  /api/workspaces/:org/projects/:id/shares { shares:[{teamId, role}] }
```

`PUT …/shares` replaces the **whole set**. Whoever is no longer in the list
loses access — and the server deletes their wrapped copy of the project key
along with it.

### 7. Handing in pending keys — the step only the client can do

After a share the newcomer sees the rows, but the ciphertexts are just bytes to
them. Every client should check this at startup and after every sync:

```
GET  /api/workspaces/:org/projects/:id/key-requests
     → [{ userId, name, email, key:{algorithm, publicKey}|null, keyIds:[…] }]

     for everyone who lacks your keyId and has a publicKey:
         wrap PK for them

POST /api/workspaces/:org/projects/:id/keys
     { keyId, grants:[{ userId, ephemeralPublicKey, nonce, wrappedKey }] }
```

`key: null` means: this person has not set up a master password yet. Nothing
can be wrapped for them — that is not an error but information for the UI
("waiting for setup").

The server only accepts wrapped keys from someone who may edit the project,
for an existing version only if the sender holds that version themselves
(otherwise `403`), and only for recipients who actually have access
(otherwise `400`).

### 8. Revocation

```
PUT    …/projects/:id/shares                  ← without the team
DELETE …/projects/:id/keys/:userId            ← revoke a single copy
```

Both take the wrapped copy away. **What that person has read until then, they
still know.** It is only truly sealed with a new version.

Which projects are affected after someone was removed from the workspace or a
team, the server tells you (owner and admin only):

```
GET  …/members/:userId/stale-keys             → { projectIds: [...] }
```

These are the projects whose **current** version they hold without being
allowed to see them anymore. A project they can still see is not in it — they
would get the new version anyway.

### 9. A new version of the project key

```
   client generates PK2 and a new keyId
GET  …/projects/:id/key-requests              ← who is entitled now
POST …/projects/:id/keys                      { keyId: new, grants:[everyone with a publicKey] }
   for each secret: open with the old version, rewrap with PK2
PUT  …/connections/:id/secret                 { keyId: new, nonce, ciphertext }
```

Wrap first, then re-encrypt — the server does not accept a `secret` under a
`keyId` nobody holds. Whoever has no master password yet gets the new version
later through step 7. The project keys come in the sync sorted by `createdAt`;
the last version per project is the one new secrets belong under.

The first `POST` with a new `keyId` also clears away all copies held by someone
who may no longer see the project — the new version has taken care of them.
Before that they stay, because `stale-keys` needs them.

## Sync

`workspaces_load` loads the whole document. Over a wire with several devices
that no longer works.

Every organization keeps a **change counter** (`revision`, BIGINT). Every row
written carries the value the counter had at that moment.

```
GET /api/workspaces/:org/sync?since=0     → everything you may see
GET /api/workspaces/:org/sync?since=17    → only what came after
```

The answer:

```jsonc
{
  "workspace": { "id", "name", "slug", "kind", "role" },
  "revision":  "42",        // ← continue from here next time
  "projects":      [ { "id","name","position","createdById","revision","deletedAt" } ],
  "connections":   [ { "id","projectId","name","type","bookmarked","position",
                       "system","revision","deletedAt", "ssh"|"ftp"|"s3" } ],
  "secrets":       [ { "connectionId","algorithm","keyId","nonce","ciphertext",
                       "revision","deletedAt" } ],
  "vaultAccounts": [ { "id","provider","account","server","acceptInvalidCert",
                       "revision","deletedAt" } ],
  "knownHosts":    [ { "id","host","port","algorithm","publicKey","trustedById",
                       "revision","deletedAt" } ],
  "snippets":      [ { "id","name","folder","command","position",
                       "revision","deletedAt" } ],
  "projectKeys":   [ { "projectId","userId","keyId","algorithm",
                       "ephemeralPublicKey","nonce","wrappedKey" } ],
  "shares":        [ { "id","projectId","teamId","role" } ]
}
```

What matters here:

**Tombstones.** Nothing is deleted; `deletedAt` is set and the revision raised.
A device that has been offline since the deletion would otherwise never learn
of it. So the client has to treat `deletedAt != null` as "remove from my copy"
— not as a normal entry.

**`projectKeys` and `shares` are not a delta.** They always come complete.
Both are a handful of rows, and a key missing because `since` is too high
would make a project unreadable.

**Revisions are strings.** `JSON.stringify` throws on a BigInt, and a number
would be wrong from 2^53 on. In Rust that means `String` or `u64` via
`serde(with = "...")` — not `f64`.

**Conflicts.** Every writing route optionally takes `expectedRevision` (the
revision you had in front of you while editing). If it no longer matches, you
get `409 R-CF` instead of a silent overwrite. Without the field the last
writer wins.

## Endpoints

Base: `/api/`. Authentication by cookie **or** by the `x-api-key` header with
a personal API key (`user_…`). For a desktop client without a cookie jar the
key is the simpler way.

Every address may make a limited number of requests per minute (600 by
default); above that the server answers `429 RL`. Sign-in, sign-up and the
mail endpoints are throttled more tightly by better-auth (three attempts per
ten seconds or per minute).

### better-auth

| Method | Path                                                 |
| ------ | ---------------------------------------------------- |
| POST   | `/api/auth/sign-up/email`                            |
| POST   | `/api/auth/sign-in/email`                            |
| GET    | `/api/auth/get-session`                              |
| POST   | `/api/auth/update-user`                              |
| POST   | `/api/auth/request-password-reset`                   |
| POST   | `/api/auth/send-verification-email`                  |
| POST   | `/api/auth/api-key/create`                           |
| GET    | `/api/auth/organization/list-user-invitations`       |
| POST   | `/api/auth/organization/create`                      |
| POST   | `/api/auth/organization/invite-member`               |
| POST   | `/api/auth/organization/accept-invitation`           |
| POST   | `/api/auth/organization/create-team`                 |
| POST   | `/api/auth/organization/add-team-member`             |
| GET    | `/api/auth/organization/list-teams?organizationId=…` |

`list-user-invitations` answers `403 EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION`
as long as the address is not verified. `send-verification-email` with
`{ email }` sends the link again; if the address is already verified, you get
`400 EMAIL_ALREADY_VERIFIED`.

In [WireCloud mode](README.md#wirecloud-mode) none of this exists; the client
then sends a WireCloud token as `Authorization: Bearer …` instead.

### Key material

| Method | Path                             | Body / answer                                              |
| ------ | -------------------------------- | ---------------------------------------------------------- |
| GET    | `/api/keys/me`                   | `{ algorithm, publicKey, master{…}, recoveryKeys[] }`      |
| POST   | `/api/keys/me`                   | `{ algorithm?, publicKey, master, recoveryKeys[] }` — once |
| POST   | `/api/keys/me/rewrap`            | `{ master, recoveryKeys[]? }`                              |
| POST   | `/api/keys/me/recovery/:id/used` | —                                                          |

`master` and every `recoveryKeys` entry:

```jsonc
{
	"wrapAlgorithm": "xchacha20poly1305", // optional, this is the default
	"nonce": "base64",
	"encryptedPrivateKey": "base64",
	"kdf": "argon2id", // optional, this is the default
	"kdfSalt": "base64",
	"kdfParams": "{\"m\":65536,\"t\":3,\"p\":4}",
	"label": "WT7K", // recoveryKeys only, required
}
```

In the answer every `recoveryKeys` entry also carries its `id` and `usedAt`.

### Workspace

| Method     | Path                                              | Purpose                                                      |
| ---------- | ------------------------------------------------- | ------------------------------------------------------------ |
| GET        | `/api/workspaces`                                 | `[{ id, name, slug, kind, role, revision }]`                 |
| GET        | `/api/workspaces/:org/sync?since=N`               | the sync                                                     |
| POST       | `/api/workspaces/:org/projects`                   | `{ id, name, position? }`                                    |
| PATCH      | `/api/workspaces/:org/projects/:id`               | `{ name?, position?, expectedRevision? }`                    |
| DELETE     | `/api/workspaces/:org/projects/:id`               | tombstone                                                    |
| GET/PUT    | `/api/workspaces/:org/projects/:id/shares`        | `{ shares:[{teamId, role}] }`                                |
| GET        | `/api/workspaces/:org/projects/:id/key-requests`  | who is missing something                                     |
| POST       | `/api/workspaces/:org/projects/:id/keys`          | `{ keyId, grants[] }`                                        |
| DELETE     | `/api/workspaces/:org/projects/:id/keys/:userId`  | revoke a copy                                                |
| GET        | `/api/workspaces/:org/members/:userId/stale-keys` | what to renew after a removal                                |
| GET        | `/api/workspaces/:org/member-keys`                | public keys of all members                                   |
| POST       | `/api/workspaces/:org/projects/:id/connections`   | create a connection                                          |
| PATCH      | `/api/workspaces/:org/connections/:id`            | change it                                                    |
| DELETE     | `/api/workspaces/:org/connections/:id`            | tombstone                                                    |
| PUT/DELETE | `/api/workspaces/:org/connections/:id/secret`     | ciphertext                                                   |
| PUT/DELETE | `/api/workspaces/:org/vault-accounts/:provider`   | `onePassword` \| `bitwarden`                                 |
| POST       | `/api/workspaces/:org/known-hosts`                | `{ host, port?, algorithm, publicKey }`                      |
| DELETE     | `/api/workspaces/:org/known-hosts/:id`            | revoke trust                                                 |
| POST       | `/api/workspaces/:org/snippets`                   | `{ id, name, command, folder?, position? }`                  |
| PATCH      | `/api/workspaces/:org/snippets/:id`               | `{ name?, command?, folder?, position?, expectedRevision? }` |
| DELETE     | `/api/workspaces/:org/snippets/:id`               | tombstone                                                    |

### Connections

The settings come in a field named after the type — the same tagged enum as
`ConnectionSettings` in the client, only in the notation JSON allows:

```jsonc
{
  "id": "7d3f1c2a-5b8e-4f60-9a1d-2c4b6e8f0a13",   // UUID, from the client
  "name": "web01",
  "type": "ssh",                    // ssh | ftp | s3
  "bookmarked": false,
  "position": 0,
  "system": { "id","name","version","pretty" },   // or null
  "ssh": {
    "host": "web01.example.com", "port": 22, "user": "root",
    "authSource": "inlineKey",     // inlineKey | keyFile | vault | password | vaultPassword | prompt | agent
    "keyFilePath": null,
    "vaultProvider": null,          // onePassword | bitwarden
    "vaultReference": null,
    "startPath": "",                // directory to start in
    "jumpConnectionId": null,       // ID of another SSH connection as jump host
    "agentForwarding": false,       // forward the SSH agent to the server
    "startupSnippetId": null,       // ID of a snippet that runs after connecting
    "forwards": [                   // port forwards, like ssh -L / -R / -D
      { "kind": "local", "bindHost": "127.0.0.1", "bindPort": 8080,
        "targetHost": "db", "targetPort": 5432 }
    ],
    "proxy": { "mode": "custom", "kind": "socks5", "host": "proxy.internal", "port": 1080 }
  }
}
```

Exactly **one** of the three groups, matching `type` — otherwise `400 C-SM`.
On `PATCH` the settings come as a whole or not at all; changing the type is
allowed and clears the old group away. With `projectId` the connection moves
into another project of the same workspace — that needs edit rights on both.
The secret then still sits under the old project's key; the client rewraps it
under the new one's (`PUT …/secret` with its `keyId`).

`forwards[].kind` is `local`, `remote` or `dynamic`. In the answer `system`
also carries `seenAt`, the time the server last received it.

`ftp` additionally: `authSource` from `anonymous|password|vault|prompt`,
`security` from `plain|explicit|implicit`, `passive`, `acceptInvalidCert`,
`startPath`. `s3` additionally: `authSource` from `secret|vault|prompt`,
`region`, `bucket`, `prefix`, `tls`, `pathStyle`, `acceptInvalidCert`,
`storageClass`.

Snippets are the workspace's saved commands, with a `/`-separated `folder`.
Every member may read them; only owner and admin may create, change and
delete them: an SSH connection can name one as its `startupSnippetId`, and it
then runs unasked in the terminal of every colleague. Placeholders like
`{{connection.host}}` are replaced by the client; the server stores the text
as it comes.

`proxy` exists for all three types: `{ "mode": "direct" }` for no proxy,
`{ "mode": "custom", "kind": "socks5"|"http", "host", "port" }` for a custom
one. If it is missing, the client uses the default proxy of the device it runs
on — that is not stored on the server. Proxy authentication does not belong
here: the schema strips user and password.

For `ssh`, `vault` is a private key from the vault and `vaultPassword` a
password from it; `password` is a fixed password, `prompt` asks for it when
connecting, `agent` authenticates through the local SSH agent (OpenSSH agent
or Pageant).

Only `inlineKey`, `password` (for `ssh` as well as `ftp`) and `secret` have a
`Secret` at all. `vault` and `vaultPassword` store a reference, `prompt`,
`agent` and `anonymous` nothing.

### Errors

Always `{ "code": "…", "detail": "…" }`:

| Code              | Meaning                                       |
| ----------------- | --------------------------------------------- |
| `A-NA`            | not signed in (401)                           |
| `A-NATR`          | no access (403)                               |
| `W-NF`            | workspace not found / not a member (404)      |
| `P-NF` / `P-EX`   | project not found (404) / exists (409)        |
| `C-NF` / `C-EX`   | connection not found / exists                 |
| `C-SM`            | `type` and settings do not match (400)        |
| `S-NF`            | secret not found                              |
| `K-NF` / `K-EX`   | key pair missing (404) / already exists (409) |
| `RK-NF`           | recovery code not found                       |
| `T-NF`            | team not found                                |
| `KH-NF`           | host key not found                            |
| `SN-NF` / `SN-EX` | snippet not found (404) / exists (409)        |
| `R-CF`            | `expectedRevision` no longer matches (409)    |
| `I-IP`            | invalid input (400)                           |
| `RL`              | too many requests (429)                       |

The `WC-*` codes of WireCloud mode are listed in
[README.md](README.md#wirecloud-mode).

All bytes travel as **base64** (standard alphabet, padding optional).

## What the client has to bring

From the Bitwarden module the tree already contains: `argon2`, `base64`,
`sha2`, `aes`, `cbc`, `rsa`, `ring`.

These are added — all pure Rust from the RustCrypto family, so the same
constraints as the rest (no cmake, no NASM):

```toml
x25519-dalek      = { version = "2", features = ["static_secrets"] }
chacha20poly1305  = "0.10"   # for XChaCha20Poly1305 (24-byte nonce)
hkdf              = "0.12"   # HKDF-SHA256 for the key derivation
zeroize           = "1"      # recommended: wipe masterKey and PK after use
```

> `ring` is already there and can do X25519, but only ChaCha20-Poly1305 with a
> 96-bit nonce — not XChaCha20 with 192 bits. Hence the separate crate. The
> versions have not been built against the client's toolchain; check that when
> adding them.

Also to keep in mind:

- **The private key and `PK` must never go to disk.** Memory only, for the
  duration of the session.
- **A lock after inactivity** would be consistent — like Bitwarden. Then the
  master password has to be asked for again.
- **Check `key-requests` at every start**, otherwise colleagues stay stuck.
- **Creating offline** is planned for: IDs come from the client. A local queue
  that uploads on the next connection fits the model.

## What is still missing

- **The metadata is readable.** Host, port, user name and names are in plain
  text in the database. Decided that way deliberately, so the server can sort
  and sync field by field — but it should be known.
- **Ciphertexts go to everyone who may see the project**, even without a key.
  Intended (they need them locally as soon as they get one), but more than
  necessary.
- **Invitations need SMTP.** Locally maildev catches them
  (`http://localhost:8082`).
