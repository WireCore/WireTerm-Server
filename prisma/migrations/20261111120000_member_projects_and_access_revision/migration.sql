-- Whether members may create projects (and then manage the ones they created).
-- AlterTable
ALTER TABLE `organization` ADD COLUMN `memberProjects` BOOLEAN NOT NULL DEFAULT false;

-- When a member's access last changed: a sync from before that point returns
-- everything, because the rows that became visible are older than `since`.
-- AlterTable
ALTER TABLE `member` ADD COLUMN `accessRevision` BIGINT NOT NULL DEFAULT 0;
