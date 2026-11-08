-- CreateTable
CREATE TABLE `external_ref` (
    `id` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(16) NOT NULL,
    `localId` VARCHAR(191) NOT NULL,
    `issuer` VARCHAR(255) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `external_ref_entityType_localId_idx`(`entityType`, `localId`),
    UNIQUE INDEX `external_ref_entityType_issuer_externalId_key`(`entityType`, `issuer`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
