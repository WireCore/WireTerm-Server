/// Why a token was rejected. The kind is meant for logs and tests; it is not
/// sent to the client: an attacker should not learn which check they have to
/// get around next.
export type TokenErrorKind =
	| 'malformed'
	| 'invalid_signature'
	| 'unknown_key'
	| 'invalid_issuer'
	| 'invalid_audience'
	| 'expired'
	| 'not_yet_valid'
	| 'unsupported_version'
	| 'jwks_unavailable';

export class TokenError extends Error {
	constructor(
		readonly kind: TokenErrorKind,
		message?: string
	) {
		super(message ?? kind);
		this.name = 'TokenError';
	}
}
