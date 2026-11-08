-- AlterTable
ALTER TABLE `ftp_connection` ADD COLUMN `proxy` JSON NULL;

-- AlterTable
ALTER TABLE `s3_connection` ADD COLUMN `proxy` JSON NULL;

-- AlterTable
ALTER TABLE `ssh_connection` ADD COLUMN `proxy` JSON NULL;
