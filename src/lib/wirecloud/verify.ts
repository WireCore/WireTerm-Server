import { errors, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { SUPPORTED_VERSIONS, WireCloudClaims, parseClaims } from './claims';
import { TokenError } from './errors';

/// Where the keys come from. `JwksCache` is the implementation; a test passes
/// its own.
export type KeySource = {
	getKey: JWTVerifyGetKey;
};

export type VerifierOptions = {
	/// The issuer this tool expects (`iss`).
	issuer: string;
	/// The identifier of this tool instance (`aud`).
	audience: string;
	keys: KeySource;
	/// Tolerance for `exp` and `iat`.
	clockSkewSeconds?: number;
	/// The module rejects a lifetime longer than this, even if the signature
	/// is valid: WireCloud does not issue tokens that long.
	maxLifetimeSeconds?: number;
	now?: () => Date;
};

const MAX_TOKEN_LENGTH = 8192;

export function mapError(error: unknown): TokenError {
	if (error instanceof TokenError) return error;
	if (error instanceof errors.JWSSignatureVerificationFailed) {
		return new TokenError('invalid_signature');
	}
	if (error instanceof errors.JWKSNoMatchingKey) {
		return new TokenError('unknown_key');
	}
	if (error instanceof errors.JWTExpired) return new TokenError('expired');
	if (error instanceof errors.JWTClaimValidationFailed) {
		switch (error.claim) {
			case 'iss':
				return new TokenError('invalid_issuer');
			case 'aud':
				return new TokenError('invalid_audience');
			case 'nbf':
				return new TokenError('not_yet_valid');
			default:
				return new TokenError('malformed');
		}
	}
	// Everything else (wrong structure, disallowed algorithm, ...).
	return new TokenError('malformed');
}

/// Verifies a tool token in the order from VERTRAG.md 6.4: signature, `iss`,
/// `aud`, `exp` and `iat`, contract version, shape of the claims. Works offline
/// with the JWKS and never accepts an expired token.
export function createVerifier(options: VerifierOptions) {
	const skew = options.clockSkewSeconds ?? 60;
	const maxLifetime = options.maxLifetimeSeconds ?? 3600;
	const now = options.now ?? (() => new Date());

	return {
		async verify(token: string): Promise<WireCloudClaims> {
			if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
				throw new TokenError('malformed');
			}

			let payload;
			try {
				({ payload } = await jwtVerify(token, options.keys.getKey, {
					issuer: options.issuer,
					audience: options.audience,
					// Only the algorithm WireCloud uses. That rules out `none`
					// and confusion with a shared secret.
					algorithms: ['EdDSA'],
					// User tokens carry `typ: JWT`. An admin token (`wc-admin`)
					// is never valid here, even with a genuine signature.
					typ: 'JWT',
					clockTolerance: skew,
					currentDate: now(),
				}));
			} catch (error) {
				throw mapError(error);
			}

			const claims = parseClaims(payload);

			const nowSeconds = Math.floor(now().getTime() / 1000);
			if (claims.issuedAt > nowSeconds + skew) {
				throw new TokenError('not_yet_valid');
			}
			if (claims.expiresAt - claims.issuedAt > maxLifetime) {
				throw new TokenError('malformed');
			}
			if (!SUPPORTED_VERSIONS.includes(claims.version)) {
				throw new TokenError('unsupported_version');
			}
			return claims;
		},
	};
}
