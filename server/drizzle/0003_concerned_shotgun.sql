CREATE TABLE `agent_plugins` (
	`agent_id` text NOT NULL,
	`plugin_name` text NOT NULL,
	`level_override` integer,
	PRIMARY KEY(`agent_id`, `plugin_name`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plugin_name`) REFERENCES `plugins`(`name`) ON UPDATE no action ON DELETE cascade
);
