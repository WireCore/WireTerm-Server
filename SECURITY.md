# Security policy

WireTerm stores the keys to other people's servers. We take reports about its
security seriously and are grateful for them.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub:
**Security → Report a vulnerability** in this repository. Include what is
affected, how to reproduce it and what an attacker gains.

We confirm receipt within a few working days, keep you informed while we work
on a fix and credit you in the release notes unless you prefer otherwise.

## Scope

In scope is this repository: the server, its API and how it stores and hands
out data. The encryption of secrets happens in the desktop client
(`wirecore/wireterm`); a flaw there belongs in that repository, but a report
here reaches the same people.

## Supported versions

Security fixes go into the latest release. Please update before reporting.
