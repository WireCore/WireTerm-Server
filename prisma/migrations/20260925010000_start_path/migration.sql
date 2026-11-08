-- AlterTable
ALTER TABLE `ssh_connection` ADD COLUMN `startPath` VARCHAR(1024) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `ftp_connection` ADD COLUMN `startPath` VARCHAR(1024) NOT NULL DEFAULT '';
