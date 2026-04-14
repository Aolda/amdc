CREATE TABLE `agent_mcp_tools` (
	`agent_id` text NOT NULL,
	`mcp_name` text NOT NULL,
	`tool_name` text NOT NULL,
	`level_override` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `mcp_name`, `tool_name`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mcp_name`) REFERENCES `mcps`(`name`) ON UPDATE no action ON DELETE cascade
);
