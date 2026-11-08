-- AlterTable
ALTER TABLE `ssh_connection` ADD COLUMN `jumpConnectionId` VARCHAR(191) NULL,
    ADD COLUMN `agentForwarding` BOOLEAN NOT NULL DEFAULT false;
