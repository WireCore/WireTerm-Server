-- AlterTable
ALTER TABLE `ssh_connection` MODIFY `authSource` ENUM('inlineKey', 'keyFile', 'vault', 'password', 'vaultPassword', 'prompt', 'agent') NOT NULL;
