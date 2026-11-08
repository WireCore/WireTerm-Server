-- CreateTable
CREATE TABLE `user` (
    `id` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `emailVerified` BOOLEAN NOT NULL DEFAULT false,
    `image` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `session` (
    `id` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `ipAddress` TEXT NULL,
    `userAgent` TEXT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `activeOrganizationId` TEXT NULL,
    `activeTeamId` TEXT NULL,

    INDEX `session_userId_idx`(`userId`),
    UNIQUE INDEX `session_token_key`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` TEXT NOT NULL,
    `providerId` TEXT NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `accessToken` TEXT NULL,
    `refreshToken` TEXT NULL,
    `idToken` TEXT NULL,
    `accessTokenExpiresAt` DATETIME(3) NULL,
    `refreshTokenExpiresAt` DATETIME(3) NULL,
    `scope` TEXT NULL,
    `password` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `account_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verification` (
    `id` VARCHAR(191) NOT NULL,
    `identifier` TEXT NOT NULL,
    `value` TEXT NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `verification_identifier_idx`(`identifier`(191)),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `apikey` (
    `id` VARCHAR(191) NOT NULL,
    `configId` TEXT NOT NULL,
    `name` TEXT NULL,
    `start` TEXT NULL,
    `referenceId` TEXT NOT NULL,
    `prefix` TEXT NULL,
    `key` TEXT NOT NULL,
    `refillInterval` INTEGER NULL,
    `refillAmount` INTEGER NULL,
    `lastRefillAt` DATETIME(3) NULL,
    `enabled` BOOLEAN NULL DEFAULT true,
    `rateLimitEnabled` BOOLEAN NULL DEFAULT true,
    `rateLimitTimeWindow` INTEGER NULL DEFAULT 86400000,
    `rateLimitMax` INTEGER NULL DEFAULT 10,
    `requestCount` INTEGER NULL DEFAULT 0,
    `remaining` INTEGER NULL,
    `lastRequest` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `permissions` TEXT NULL,
    `metadata` TEXT NULL,

    INDEX `apikey_configId_idx`(`configId`(191)),
    INDEX `apikey_referenceId_idx`(`referenceId`(191)),
    INDEX `apikey_key_idx`(`key`(191)),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `organization` (
    `id` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `logo` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `metadata` TEXT NULL,
    `revision` BIGINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `organization_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,

    INDEX `member_organizationId_idx`(`organizationId`),
    INDEX `member_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invitation` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `email` TEXT NOT NULL,
    `role` TEXT NULL,
    `teamId` TEXT NULL,
    `status` TEXT NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `inviterId` VARCHAR(191) NOT NULL,

    INDEX `invitation_organizationId_idx`(`organizationId`),
    INDEX `invitation_email_idx`(`email`(191)),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team` (
    `id` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `memberCount` INTEGER NOT NULL DEFAULT 0,
    `organizationId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NULL,

    INDEX `team_organizationId_idx`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_member` (
    `id` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `membershipKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NULL,

    UNIQUE INDEX `team_member_membershipKey_key`(`membershipKey`),
    INDEX `team_member_teamId_idx`(`teamId`),
    INDEX `team_member_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_key` (
    `userId` VARCHAR(191) NOT NULL,
    `algorithm` VARCHAR(64) NOT NULL DEFAULT 'x25519',
    `publicKey` VARBINARY(64) NOT NULL,
    `wrapAlgorithm` VARCHAR(64) NOT NULL DEFAULT 'xchacha20poly1305',
    `nonce` VARBINARY(32) NOT NULL,
    `encryptedPrivateKey` BLOB NOT NULL,
    `kdf` VARCHAR(64) NOT NULL DEFAULT 'argon2id',
    `kdfSalt` VARBINARY(32) NOT NULL,
    `kdfParams` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recovery_key` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(16) NOT NULL,
    `wrapAlgorithm` VARCHAR(64) NOT NULL DEFAULT 'xchacha20poly1305',
    `nonce` VARBINARY(32) NOT NULL,
    `encryptedPrivateKey` BLOB NOT NULL,
    `kdf` VARCHAR(64) NOT NULL DEFAULT 'argon2id',
    `kdfSalt` VARBINARY(32) NOT NULL,
    `kdfParams` VARCHAR(255) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recovery_key_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vault_account` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `provider` ENUM('onePassword', 'bitwarden') NOT NULL,
    `account` VARCHAR(255) NOT NULL DEFAULT '',
    `server` VARCHAR(255) NOT NULL DEFAULT '',
    `acceptInvalidCert` BOOLEAN NOT NULL DEFAULT false,
    `revision` BIGINT NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `vault_account_organizationId_revision_idx`(`organizationId`, `revision`),
    UNIQUE INDEX `vault_account_organizationId_provider_key`(`organizationId`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdById` VARCHAR(191) NULL,
    `revision` BIGINT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `project_organizationId_revision_idx`(`organizationId`, `revision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_share` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NULL,
    `role` ENUM('editor', 'viewer') NOT NULL DEFAULT 'editor',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_share_projectId_idx`(`projectId`),
    INDEX `project_share_teamId_idx`(`teamId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_key` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `keyId` VARCHAR(64) NOT NULL,
    `algorithm` VARCHAR(64) NOT NULL DEFAULT 'x25519-xchacha20poly1305',
    `ephemeralPublicKey` VARBINARY(64) NOT NULL,
    `nonce` VARBINARY(32) NOT NULL,
    `wrappedKey` VARBINARY(255) NOT NULL,
    `grantedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_key_userId_idx`(`userId`),
    UNIQUE INDEX `project_key_projectId_userId_keyId_key`(`projectId`, `userId`, `keyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `connection` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `type` ENUM('ssh', 'ftp', 's3') NOT NULL,
    `bookmarked` BOOLEAN NOT NULL DEFAULT false,
    `position` INTEGER NOT NULL DEFAULT 0,
    `systemId` VARCHAR(64) NULL,
    `systemName` VARCHAR(128) NULL,
    `systemVersion` VARCHAR(64) NULL,
    `systemPretty` VARCHAR(255) NULL,
    `systemSeenAt` DATETIME(3) NULL,
    `revision` BIGINT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `connection_projectId_idx`(`projectId`),
    INDEX `connection_revision_idx`(`revision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ssh_connection` (
    `connectionId` VARCHAR(191) NOT NULL,
    `host` VARCHAR(255) NOT NULL,
    `port` INTEGER NOT NULL DEFAULT 22,
    `user` VARCHAR(255) NOT NULL,
    `authSource` ENUM('inlineKey', 'keyFile', 'vault') NOT NULL,
    `keyFilePath` VARCHAR(1024) NULL,
    `vaultProvider` ENUM('onePassword', 'bitwarden') NULL,
    `vaultReference` VARCHAR(1024) NULL,

    PRIMARY KEY (`connectionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ftp_connection` (
    `connectionId` VARCHAR(191) NOT NULL,
    `host` VARCHAR(255) NOT NULL,
    `port` INTEGER NOT NULL DEFAULT 21,
    `user` VARCHAR(255) NOT NULL,
    `authSource` ENUM('anonymous', 'password', 'vault', 'prompt') NOT NULL,
    `vaultProvider` ENUM('onePassword', 'bitwarden') NULL,
    `vaultReference` VARCHAR(1024) NULL,
    `security` ENUM('plain', 'explicit', 'implicit') NOT NULL DEFAULT 'explicit',
    `passive` BOOLEAN NOT NULL DEFAULT true,
    `acceptInvalidCert` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`connectionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `s3_connection` (
    `connectionId` VARCHAR(191) NOT NULL,
    `host` VARCHAR(255) NOT NULL,
    `port` INTEGER NOT NULL DEFAULT 443,
    `user` VARCHAR(255) NOT NULL,
    `authSource` ENUM('secret', 'vault', 'prompt') NOT NULL,
    `vaultProvider` ENUM('onePassword', 'bitwarden') NULL,
    `vaultReference` VARCHAR(1024) NULL,
    `region` VARCHAR(64) NOT NULL DEFAULT 'us-east-1',
    `bucket` VARCHAR(255) NOT NULL DEFAULT '',
    `prefix` VARCHAR(1024) NOT NULL DEFAULT '',
    `tls` BOOLEAN NOT NULL DEFAULT true,
    `pathStyle` BOOLEAN NOT NULL DEFAULT false,
    `acceptInvalidCert` BOOLEAN NOT NULL DEFAULT false,
    `storageClass` VARCHAR(64) NOT NULL DEFAULT '',

    PRIMARY KEY (`connectionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `secret` (
    `connectionId` VARCHAR(191) NOT NULL,
    `algorithm` VARCHAR(64) NOT NULL DEFAULT 'xchacha20poly1305',
    `keyId` VARCHAR(64) NOT NULL,
    `nonce` VARBINARY(32) NOT NULL,
    `ciphertext` MEDIUMBLOB NOT NULL,
    `revision` BIGINT NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `secret_revision_idx`(`revision`),
    PRIMARY KEY (`connectionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `known_host_key` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `host` VARCHAR(255) NOT NULL,
    `port` INTEGER NOT NULL DEFAULT 22,
    `algorithm` VARCHAR(64) NOT NULL,
    `publicKey` TEXT NOT NULL,
    `trustedById` VARCHAR(191) NULL,
    `revision` BIGINT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    INDEX `known_host_key_organizationId_revision_idx`(`organizationId`, `revision`),
    UNIQUE INDEX `known_host_key_organizationId_host_port_algorithm_key`(`organizationId`, `host`, `port`, `algorithm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `session` ADD CONSTRAINT `session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account` ADD CONSTRAINT `account_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member` ADD CONSTRAINT `member_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member` ADD CONSTRAINT `member_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitation` ADD CONSTRAINT `invitation_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitation` ADD CONSTRAINT `invitation_inviterId_fkey` FOREIGN KEY (`inviterId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team` ADD CONSTRAINT `team_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_member` ADD CONSTRAINT `team_member_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_member` ADD CONSTRAINT `team_member_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_key` ADD CONSTRAINT `user_key_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recovery_key` ADD CONSTRAINT `recovery_key_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vault_account` ADD CONSTRAINT `vault_account_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project` ADD CONSTRAINT `project_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project` ADD CONSTRAINT `project_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_share` ADD CONSTRAINT `project_share_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_share` ADD CONSTRAINT `project_share_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_key` ADD CONSTRAINT `project_key_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_key` ADD CONSTRAINT `project_key_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_key` ADD CONSTRAINT `project_key_grantedById_fkey` FOREIGN KEY (`grantedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `connection` ADD CONSTRAINT `connection_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ssh_connection` ADD CONSTRAINT `ssh_connection_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `connection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ftp_connection` ADD CONSTRAINT `ftp_connection_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `connection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `s3_connection` ADD CONSTRAINT `s3_connection_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `connection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `secret` ADD CONSTRAINT `secret_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `connection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `known_host_key` ADD CONSTRAINT `known_host_key_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `known_host_key` ADD CONSTRAINT `known_host_key_trustedById_fkey` FOREIGN KEY (`trustedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

