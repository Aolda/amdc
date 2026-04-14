CREATE TABLE `agent_sub_agents` (
	`agent_id` text NOT NULL,
	`sub_agent_id` text NOT NULL,
	PRIMARY KEY(`agent_id`, `sub_agent_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sub_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
