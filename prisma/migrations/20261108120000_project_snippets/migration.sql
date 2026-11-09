-- Snippets move from the workspace to a project (and, optionally, one of its
-- connections). A workspace snippet has no project to go to, so the existing
-- ones are dropped, together with the startup commands pointing at them.
UPDATE `ssh_connection` SET `startupSnippetId` = NULL WHERE `startupSnippetId` IS NOT NULL;
DELETE FROM `snippet`;

-- DropForeignKey
ALTER TABLE `snippet` DROP FOREIGN KEY `snippet_organizationId_fkey`;

-- DropIndex
DROP INDEX `snippet_organizationId_revision_idx` ON `snippet`;

-- AlterTable
ALTER TABLE `snippet` DROP COLUMN `organizationId`,
    ADD COLUMN `connectionId` VARCHAR(191) NULL,
    ADD COLUMN `locked` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `projectId` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE INDEX `snippet_projectId_revision_idx` ON `snippet`(`projectId`, `revision`);

-- CreateIndex
CREATE INDEX `snippet_connectionId_idx` ON `snippet`(`connectionId`);

-- AddForeignKey
ALTER TABLE `snippet` ADD CONSTRAINT `snippet_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `snippet` ADD CONSTRAINT `snippet_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `connection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
