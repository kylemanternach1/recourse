import { spawn } from 'node:child_process'
import path from 'node:path'
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'
import type { SandboxPolicy, SandboxRunResult } from '../../shared/contracts'
import { prependRuntimePath, resolveRuntimePaths } from '../skills/runtimePaths'
import { toSandboxRuntimeConfig } from './policies'

export interface SandboxRunOptions {
  command: string
  cwd: string
  policy: SandboxPolicy
  onOutput?: (stream: 'stdout' | 'stderr' | 'sandbox', message: string) => void
}

type SandboxRuntimeModule = {
  SandboxManager?: {
    initialize?: (config: SandboxRuntimeConfig) => Promise<unknown>
    wrapWithSandbox?: (
      command: string,
      binShell?: string,
      customConfig?: Partial<SandboxRuntimeConfig>
    ) => Promise<string>
    annotateStderrWithSandboxFailures?: (command: string, stderr: string) => string
    cleanupAfterCommand?: () => void
  }
}

export class SandboxRunner {
  async runCommand(options: SandboxRunOptions): Promise<SandboxRunResult> {
    if (options.policy.presetId === 'open') {
      options.onOutput?.('sandbox', 'Sandbox is open; running command directly in the workspace.')
      return this.spawnCommand(options)
    }

    const blockedEvents = this.validateCommand(options.command, options.policy)
    if (blockedEvents.length > 0) {
      for (const event of blockedEvents) {
        options.onOutput?.('sandbox', event)
      }

      return {
        exitCode: 126,
        stdout: '',
        stderr: blockedEvents.join('\n'),
        blockedEvents
      }
    }

    const sandbox = await this.prepareSandboxedCommand(options)
    const result = await this.spawnCommand({
      ...options,
      command: sandbox.command
    })

    if (sandbox.runtime?.annotateStderrWithSandboxFailures && result.stderr) {
      result.stderr = sandbox.runtime.annotateStderrWithSandboxFailures(options.command, result.stderr)
    }

    sandbox.runtime?.cleanupAfterCommand?.()
    return result
  }

  private validateCommand(command: string, policy: SandboxPolicy): string[] {
    const blockedEvents: string[] = []
    const sensitiveReads = [/~\/\.ssh\b/, /\/Users\/[^ ]+\/\.ssh\b/, /\bid_rsa\b/, /\bid_ed25519\b/]
    const forbiddenWrites = [/>\s*~\//, />\s*\/Users\//, /\b(git\s+config|git\s+hook)\b/]

    if (sensitiveReads.some((pattern) => pattern.test(command))) {
      blockedEvents.push('Blocked command before execution: attempted access to SSH/private key material.')
    }

    if (forbiddenWrites.some((pattern) => pattern.test(command))) {
      blockedEvents.push('Blocked command before execution: attempted write outside the task workspace.')
    }

    if (!this.isWithinWorkspace(optionsSafeCwd(command, policy.workspacePath), policy.workspacePath)) {
      blockedEvents.push('Blocked command before execution: working directory is outside the task workspace.')
    }

    return blockedEvents
  }

  private async prepareSandboxedCommand(options: SandboxRunOptions): Promise<{
    command: string
    runtime?: NonNullable<SandboxRuntimeModule['SandboxManager']>
  }> {
    try {
      const runtime = (await import('@anthropic-ai/sandbox-runtime')) as unknown as SandboxRuntimeModule
      const config = toSandboxRuntimeConfig(options.policy)
      await runtime.SandboxManager?.initialize?.(config)
      const command = await runtime.SandboxManager?.wrapWithSandbox?.(options.command, undefined, config)
      options.onOutput?.('sandbox', 'Sandbox runtime initialized with workspace-scoped policy.')

      return {
        command: command ?? options.command,
        runtime: runtime.SandboxManager
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      options.onOutput?.('sandbox', `Sandbox runtime unavailable, using local guarded runner: ${message}`)
      return { command: options.command }
    }
  }

  private spawnCommand(options: SandboxRunOptions): Promise<SandboxRunResult> {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''

      const isOpen = options.policy.presetId === 'open'
      const runtime = resolveRuntimePaths()
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: prependRuntimePath(process.env.PATH),
        VIRTUAL_ENV: runtime.venvDir,
        RECOURSE_WORKSPACE: options.policy.workspacePath
      }
      if (!isOpen) {
        env.HOME = options.policy.workspacePath
      }

      const child = spawn(options.command, {
        cwd: this.isWithinWorkspace(options.cwd, options.policy.workspacePath)
          ? options.cwd
          : options.policy.workspacePath,
        shell: true,
        env
      })

      child.stdout.on('data', (chunk: Buffer) => {
        const message = chunk.toString()
        stdout += message
        options.onOutput?.('stdout', message)
      })

      child.stderr.on('data', (chunk: Buffer) => {
        const message = chunk.toString()
        stderr += message
        options.onOutput?.('stderr', message)
      })

      child.on('close', (exitCode) => {
        resolve({
          exitCode,
          stdout,
          stderr,
          blockedEvents: []
        })
      })

      child.on('error', (error) => {
        const message = error.message
        stderr += message
        options.onOutput?.('stderr', message)
        resolve({
          exitCode: 1,
          stdout,
          stderr,
          blockedEvents: []
        })
      })
    })
  }

  private isWithinWorkspace(candidatePath: string, workspacePath: string): boolean {
    const relativePath = path.relative(workspacePath, candidatePath)
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  }
}

function optionsSafeCwd(command: string, workspacePath: string): string {
  const cdMatch = command.match(/\bcd\s+([^;&|]+)/)
  if (!cdMatch) {
    return workspacePath
  }

  const requestedPath = cdMatch[1].trim().replace(/^['"]|['"]$/g, '')
  return path.isAbsolute(requestedPath) ? requestedPath : path.resolve(workspacePath, requestedPath)
}
