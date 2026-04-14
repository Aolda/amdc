-- Custom SQL migration file, put your code below! --
ALTER TABLE `plugins` RENAME TO `mcps`;
--> statement-breakpoint
ALTER TABLE `agent_plugins` RENAME TO `agent_mcps`;
--> statement-breakpoint
ALTER TABLE `agent_mcps` RENAME COLUMN `plugin_name` TO `mcp_name`;