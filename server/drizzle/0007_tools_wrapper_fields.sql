ALTER TABLE `mcp_tools` ADD `kind` text DEFAULT 'mcp' NOT NULL;--> statement-breakpoint
ALTER TABLE `mcp_tools` ADD `underlying_tool_name` text;--> statement-breakpoint
ALTER TABLE `mcp_tools` ADD `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `mcp_tools` ADD `input_schema` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `mcp_tools` ADD `hidden` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `mcp_tools` ADD `config` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `mcps` ADD `config` text DEFAULT '{}' NOT NULL;