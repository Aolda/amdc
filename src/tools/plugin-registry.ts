import type {
  AgentVisiblePluginDescriptor,
  AgentVisibleToolDescriptor,
  PluginName,
  ToolCatalog,
  ToolDefinition
} from "./types.js";

export class PluginRegistry {
  private readonly pluginsByName: ReadonlyMap<PluginName, ToolCatalog["plugins"][number]>;
  private readonly toolsByName: ReadonlyMap<string, ToolDefinition>;

  constructor(catalog: ToolCatalog) {
    const plugins = new Map<PluginName, ToolCatalog["plugins"][number]>();
    const tools = new Map<string, ToolDefinition>();

    for (const plugin of catalog.plugins) {
      if (plugins.has(plugin.name)) {
        throw new Error(`Duplicate plugin name: ${plugin.name}`);
      }

      plugins.set(plugin.name, plugin);

      for (const tool of plugin.tools) {
        if (tools.has(tool.name)) {
          throw new Error(`Duplicate tool name: ${tool.name}`);
        }

        tools.set(tool.name, tool);
      }
    }

    this.pluginsByName = plugins;
    this.toolsByName = tools;
  }

  listPlugins(): readonly AgentVisiblePluginDescriptor[] {
    return [...this.pluginsByName.values()].map((plugin) => ({
      name: plugin.name,
      description: plugin.description,
      domainHints: plugin.domainHints
    }));
  }

  listToolsForPlugins(pluginNames: readonly PluginName[]): readonly AgentVisibleToolDescriptor[] {
    const selected = new Set(pluginNames);

    return [...this.pluginsByName.values()]
      .filter((plugin) => selected.has(plugin.name))
      .flatMap((plugin) =>
        plugin.tools.map((tool) => ({
          name: tool.name,
          pluginName: tool.pluginName,
          description: tool.description,
          inputSchema: tool.inputSchema,
          readOnly: true as const
        }))
      );
  }

  listAllTools(): readonly AgentVisibleToolDescriptor[] {
    return this.listToolsForPlugins([...this.pluginsByName.keys()]);
  }

  getTool(toolName: string): ToolDefinition | null {
    return this.toolsByName.get(toolName) ?? null;
  }
}
