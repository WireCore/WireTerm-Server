# Contributing

Thank you for helping with WireTerm. Bug reports, ideas and pull requests are
welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on
  the approach before you spend time on it.
- Security problems go through the private channel in [SECURITY.md](SECURITY.md),
  not through issues.

## Development

Everything runs in Docker; see [README.md](README.md) for the quickstart.

```bash
docker compose exec wireterm_node sh -c 'cd /var/www/html && npm test'
docker compose exec wireterm_node sh -c 'cd /var/www/html && npm run lint && npm run typecheck && npm run format:check'
```

Every pull request must pass lint, Prettier, the type check and the tests (the
CI runs them). Add or adjust tests for what you change.

## Guidelines

- Code, comments and commit messages are in English.
- Mails exist in every supported language (`src/templates/mail/<kind>/<locale>.njk`).
- No secret in plain text and none the server could open — read the
  encryption section of the README before adding a column that might hold one.
- Accounts, organizations and teams come from better-auth; do not add
  endpoints of your own for them.

## License

By contributing you agree that your contribution is licensed under the
[GNU AGPL v3](LICENSE), like the rest of the project.

Every commit carries a `Signed-off-by` line (`git commit -s`). With it you
confirm the [Developer Certificate of Origin](https://developercertificate.org):
you wrote the change yourself, or it is based on work under a compatible open
source license, and you have the right to contribute it under the AGPL. The DCO
check on the pull request fails without it. To add it afterwards:
`git commit --amend -s` for the last commit, `git rebase --signoff <base>` for
several, then push with `--force-with-lease`.
