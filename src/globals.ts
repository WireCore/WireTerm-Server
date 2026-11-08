import dotenv from 'dotenv';
import { secret } from './lib/env';
dotenv.config();

// Environment variables. Secrets go through `secret()` and can also be given as
// a file in `<NAME>_FILE`; see README.md, section "Environment variables".

// ---- server ----------------------------------------------------------------
export const SERVER_HOST = process.env.SERVER_HOST || '0.0.0.0';
export const SERVER_PORT = Number(process.env.SERVER_PORT) || 80;
// `fatal`, `error`, `warn`, `info` (default; logs every request), `debug`,
// `trace` or `silent`.
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
// `true` serves the API documentation under /documentation. Off by default:
// it describes every endpoint to whoever asks.
export const API_DOCS = process.env.API_DOCS === 'true';
// Who sits in front of the server and may set `X-Forwarded-For`: empty for
// nobody, `true` for everyone, a number for that many hops, otherwise a
// comma-separated list of addresses or networks. This decides which address
// the rate limit sees.
export const TRUST_PROXY = process.env.TRUST_PROXY;
// Requests per minute and address before the server answers with 429.
export const RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX;

// ---- database --------------------------------------------------------------
// The one place the connection is configured, e.g.
// mysql://user:password@host:3306/wireterm (special characters percent-encoded).
// The server and `prisma migrate` both read it.
export const DATABASE_URL = secret('DATABASE_URL');
// `true` connects over TLS and verifies the server's certificate.
export const DATABASE_SSL = process.env.DATABASE_SSL === 'true';
// A CA certificate (PEM file) to verify the database against, for services
// whose CA is not in the system store (e.g. Amazon RDS).
export const DATABASE_SSL_CA = process.env.DATABASE_SSL_CA;
export const DATABASE_CONNECTION_LIMIT =
	Number(process.env.DATABASE_CONNECTION_LIMIT) || 5;

// ---- accounts --------------------------------------------------------------
export const BETTER_AUTH_SECRET = secret('BETTER_AUTH_SECRET');
// The public address of this server, e.g. https://wireterm.example.com. Links
// in mails and the pages for password reset and invitations live under it; in
// WireCloud mode it is also this instance's identifier there.
export const PUBLIC_URL = process.env.PUBLIC_URL;
export const COOKIE_SECRET = secret('COOKIE_SECRET');
export const CORS_ORIGIN = process.env.CORS_ORIGIN;
export const BETTER_AUTH_DISABLE_ORIGIN_CHECK =
	process.env.BETTER_AUTH_DISABLE_ORIGIN_CHECK;
export const BETTER_AUTH_DISABLE_SIGNUP =
	process.env.BETTER_AUTH_DISABLE_SIGNUP;
export const BETTER_AUTH_COOKIE_DOMAIN = process.env.BETTER_AUTH_COOKIE_DOMAIN;
export const BETTER_AUTH_TRUSTED_ORIGINS =
	process.env.BETTER_AUTH_TRUSTED_ORIGINS;
// Where the links in mails point. By default to this backend's own pages
// (PUBLIC_URL); set it only for a web frontend of your own that serves
// /reset-password/<token> and /organization/acceptinvite/<id>.
export const APP_LINK_BASE = process.env.APP_LINK_BASE;

// ---- mail ------------------------------------------------------------------
export const SMTP_HOST = process.env.SMTP_HOST;
export const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
// `true` for TLS from the first byte (usually port 465), `false` for STARTTLS.
// Without a value it follows the port.
export const SMTP_SECURE = process.env.SMTP_SECURE
	? process.env.SMTP_SECURE === 'true'
	: SMTP_PORT === 465;
export const SMTP_USERNAME = process.env.SMTP_USERNAME;
export const SMTP_PASSWORD = secret('SMTP_PASSWORD');
export const SMTP_TLS_SERVERNAME = process.env.SMTP_TLS_SERVERNAME;
// Sender of the mails, e.g. `WireTerm <noreply@example.com>`. Falls back to
// SMTP_USERNAME, which with many providers is not an address.
export const SMTP_FROM = process.env.SMTP_FROM || SMTP_USERNAME;

// ---- OpenTelemetry ---------------------------------------------------------
// Further resource attributes (e.g. deployment.environment.name=production)
// come from the standard OTEL_RESOURCE_ATTRIBUTES, read by the SDK itself.
export const OTEL_SERVICE_NAME = process.env.OTEL_SERVICE_NAME;
export const OTEL_EXPORTER_OTLP_ENDPOINT =
	process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

// ---- WireCloud mode ----------------------------------------------------------
// `local` (default) or `wirecloud`. In `wirecloud` mode the sign-in comes from
// WireCloud (token), not from this backend.
export const AUTH_MODE = process.env.AUTH_MODE;
// The WireCloud this server belongs to, as clients reach it. Default: the
// hosted WireCloud of WireCore.
export const WIRECLOUD_URL = (
	process.env.WIRECLOUD_URL || 'https://api.cloud.wirecore.net'
).replace(/\/+$/, '');
// The issuer in WireCloud's tokens, and where this server fetches its keys.
// Only differs from WIRECLOUD_URL in development, where WireCloud has another
// name inside the Docker network than from the host.
export const WIRECLOUD_ISSUER = (
	process.env.WIRECLOUD_ISSUER || WIRECLOUD_URL
).replace(/\/+$/, '');
export const WIRECLOUD_JWKS_URL = `${WIRECLOUD_ISSUER}/.well-known/jwks.json`;
// This instance's identifier in WireCloud (`aud` in the tokens). Only needed
// if WireCloud lists the instance under another name than PUBLIC_URL.
export const WIRECLOUD_AUDIENCE = process.env.WIRECLOUD_AUDIENCE || PUBLIC_URL;
