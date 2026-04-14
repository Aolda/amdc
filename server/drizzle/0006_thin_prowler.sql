CREATE TABLE `mcp_tools` (
	`mcp_name` text NOT NULL,
	`tool_name` text NOT NULL,
	`level` integer NOT NULL,
	PRIMARY KEY(`mcp_name`, `tool_name`),
	FOREIGN KEY (`mcp_name`) REFERENCES `mcps`(`name`) ON UPDATE no action ON DELETE cascade
);
