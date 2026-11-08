-- AlterTable
ALTER TABLE `ssh_connection` MODIFY `authSource` ENUM('inlineKey', 'keyFile', 'vault', 'password', 'vaultPassword', 'prompt') NOT NULL;
