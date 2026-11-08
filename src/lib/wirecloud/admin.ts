import { jwtVerify } from 'jose';
import { TokenError } from './errors';
import { VerifierOptions, mapError } from './verify';

/// Verification of the admin tokens WireCloud uses to call the tool's admin API
/// (VERTRAG.md 7): `typ: wc-admin`, `aud` = this instance, `scope` names the
/// permission, lifetime at most 5 minutes. Same keys as for the user tokens,
/// but never interchangeable: the `typ` separates the two kinds, in both
/// directions.

export type AdminClaims = {
	issuer: string;
	audience: string;
	tokenId: string;
	issuedAt: number;
	expiresAt: number;
	scopes: string[];
};

const MAX_TOKEN_LENGTH = 4096;

export function createAdminVerifier(options: VerifierOptions) {
	const skew = options.clockSkewSeconds ?? 60;
	const maxLifetime = options.maxLifetimeSeconds ?? 300;
	const now = options.now ?? (() => new Date());

	return {
		async verify(token: string): Promise<AdminClaims> {
			if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
				throw new TokenError('malformed');
			}
			let payload;
			try {
				({ payload } = await jwtVerify(token, options.keys.getKey, {
					issuer: options.issuer,
					audience: options.audience,
					algorithms: ['EdDSA'],
					typ: 'wc-admin',
					clockTolerance: skew,
					currentDate: now(),
				}));
			} catch (error) {
				throw mapError(error);
			}

			const { iat, exp, jti, scope } = payload;
			if (
				typeof iat !== 'number' ||
				typeof exp !== 'number' ||
				typeof jti !== 'string' ||
				jti.length === 0 ||
				typeof scope !== 'string'
			) {
				throw new TokenError('malformed');
			}
			if (iat > Math.floor(now().getTime() / 1000) + skew) {
				throw new TokenError('not_yet_valid');
			}
			if (exp - iat > maxLifetime) throw new TokenError('malformed');

			return {
				issuer: options.issuer,
				audience: options.audience,
				tokenId: jti,
				issuedAt: iat,
				expiresAt: exp,
				scopes: scope.split(' ').filter(Boolean),
			};
		},
	};
}
