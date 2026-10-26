CREATE TABLE `training_records` (
	`user_id` text NOT NULL,
	`record_key` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`user_id`, `record_key`)
);
--> statement-breakpoint
CREATE INDEX `records_user_kind` ON `training_records` (`user_id`,`kind`);