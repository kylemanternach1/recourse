export interface ToolDefinition {
  name: string
  description: string
  requiresApproval: boolean
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>()

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool)
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }
}

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry()

  registry.register({
    name: 'sandbox.runCommand',
    description: 'Run a shell command inside the selected task workspace and sandbox policy.',
    requiresApproval: true
  })

  return registry
}
