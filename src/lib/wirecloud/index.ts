/// Verification building block for WireCloud tokens (E34, VERTRAG.md section 6.4).
///
/// This directory is deliberately self-contained: it imports only `jose` and
/// Node built-ins, neither Fastify nor Prisma nor better-auth nor other parts
/// of WireTerm. That way it can be split out unchanged as a package for other
/// tools. What a tool does with the verified claims (creating users, syncing
/// companies and teams) lives outside, in `services/`.
export { TokenError } from './errors';
export type { TokenErrorKind } from './errors';
export { SUPPORTED_VERSIONS, parseClaims } from './claims';
export type {
	WireCloudClaims,
	WireCloudMembership,
	WireCloudTeam,
} from './claims';
export { JwksCache } from './jwks';
export type { JwksCacheOptions } from './jwks';
export { createVerifier } from './verify';
export type { KeySource, VerifierOptions } from './verify';
export { createAdminVerifier } from './admin';
export type { AdminClaims } from './admin';
