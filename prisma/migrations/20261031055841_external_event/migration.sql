-- CreateTable
CREATE TABLE `external_event` (
    `id` VARCHAR(191) NOT NULL,
    `issuer` VARCHAR(255) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `scopeKey` VARCHAR(191) NOT NULL,
    `sequence` BIGINT NOT NULL,
    `type` VARCHAR(48) NOT NULL,
    `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `external_event_issuer_scopeKey_sequence_idx`(`issuer`, `scopeKey`, `sequence`),
    UNIQUE INDEX `external_event_issuer_eventId_key`(`issuer`, `eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
