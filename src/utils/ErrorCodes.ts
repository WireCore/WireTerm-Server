export enum ErrorCodes {
	// Auth
	AUTH_NOT_AUTHENTICATED = 'A-NA',
	AUTH_NO_ACCESS_TO_RESOURCE = 'A-NATR',
	// Workspace (= organization)
	WORKSPACE_NOT_FOUND = 'W-NF',
	// Project
	PROJECT_NOT_FOUND = 'P-NF',
	PROJECT_EXISTS = 'P-EX',
	// Connection
	CONNECTION_NOT_FOUND = 'C-NF',
	CONNECTION_EXISTS = 'C-EX',
	CONNECTION_SETTINGS_MISMATCH = 'C-SM',
	// Secret
	SECRET_NOT_FOUND = 'S-NF',
	// Key
	KEY_NOT_FOUND = 'K-NF',
	KEY_EXISTS = 'K-EX',
	KEY_MISMATCH = 'K-MM',
	RECOVERY_KEY_NOT_FOUND = 'RK-NF',
	// Team
	TEAM_NOT_FOUND = 'T-NF',
	// Host-Key
	KNOWN_HOST_NOT_FOUND = 'KH-NF',
	// Snippet
	SNIPPET_NOT_FOUND = 'SN-NF',
	SNIPPET_EXISTS = 'SN-EX',
	/// Unlocked or for another connection, it would leave connections behind
	/// whose startup command they may not or cannot send.
	SNIPPET_IN_USE = 'SN-IU',
	/// A startup command has to be a locked snippet for this connection.
	SNIPPET_NOT_STARTUP = 'SN-NS',
	// Concurrent change
	REVISION_CONFLICT = 'R-CF',
	// WireCloud mode
	WIRECLOUD_EMAIL_CONFLICT = 'WC-EC',
	WIRECLOUD_UNKNOWN_ROLE = 'WC-UR',
	WIRECLOUD_LINK_DENIED = 'WC-LD',
	WIRECLOUD_LINK_UNVERIFIED = 'WC-NV',
	WIRECLOUD_LINK_NOT_NEEDED = 'WC-NN',
	WIRECLOUD_LINK_RATE_LIMITED = 'WC-RL',
	// Input
	INVALID_PAYLOAD = 'I-IP',
	// Rate limit
	RATE_LIMITED = 'RL',
}
