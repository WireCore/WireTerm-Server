-- AlterTable
ALTER TABLE `ssh_connection` ADD COLUMN `startupSnippetId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `snippet` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `folder` VARCHAR(255) NOT NULL DEFAULT '',
    `command` TEXT NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `revision` BIGINT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `snippet_organizationId_revision_idx`(`organizationId`, `revision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `snippet` ADD CONSTRAINT `snippet_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
