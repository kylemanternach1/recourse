import path from 'node:path'
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'
import type { PolicyPreset, PolicyPresetId, SandboxPolicy } from '../../shared/contracts'

export const POLICY_PRESETS: PolicyPreset[] = [
  {
    id: 'open',
    name: 'Open',
    description: 'No sandbox restrictions. Use during early development.',
    defaultDomains: []
  },
  {
    id: 'no-internet',
    name: 'No Internet',
    description: 'Workspace-only filesystem access with all outbound network denied.',
    defaultDomains: []
  },
  {
    id: 'github-allowed',
    name: 'GitHub Allowed',
    description: 'Workspace-only filesystem access with GitHub and npm registry access.',
    defaultDomains: ['github.com', 'api.github.com', 'raw.githubusercontent.com', 'registry.npmjs.org']
  },
  {
    id: 'custom-domains',
    name: 'Custom Domains',
    description: 'Workspace-only filesystem access with only the domains you list.',
    defaultDomains: []
  }
]

const sensitiveWriteTargets = [
  '.env',
  '.env.local',
  '.git/config',
  '.git/hooks',
  '.npmrc',
  '.ssh',
  '.zshrc',
  '.bashrc',
  '.bash_profile'
]

export function buildSandboxPolicy(
  workspacePath: string,
  presetId: PolicyPresetId,
  customDomains: string[]
): SandboxPolicy {
  const preset = POLICY_PRESETS.find((candidate) => candidate.id === presetId) ?? POLICY_PRESETS[0]

  if (preset.id === 'open') {
    return {
      presetId: preset.id,
      workspacePath,
      filesystem: {
        denyRead: [],
        allowRead: ['/'],
        allowWrite: ['/'],
        denyWrite: []
      },
      network: {
        allowedDomains: [],
        deniedDomains: []
      }
    }
  }

  const allowedDomains = preset.id === 'custom-domains' ? customDomains : preset.defaultDomains

  return {
    presetId: preset.id,
    workspacePath,
    filesystem: {
      denyRead: ['/Users'],
      allowRead: [workspacePath],
      allowWrite: [workspacePath, path.join(workspacePath, '.tmp')],
      denyWrite: sensitiveWriteTargets
    },
    network: {
      allowedDomains: normalizeDomains(allowedDomains),
      deniedDomains: []
    }
  }
}

export function toSandboxRuntimeConfig(policy: SandboxPolicy): SandboxRuntimeConfig {
  return {
    filesystem: {
      denyRead: policy.filesystem.denyRead,
      allowRead: policy.filesystem.allowRead,
      allowWrite: policy.filesystem.allowWrite,
      denyWrite: policy.filesystem.denyWrite,
      allowGitConfig: false
    },
    network: {
      allowedDomains: policy.network.allowedDomains,
      deniedDomains: policy.network.deniedDomains
    },
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false
  }
}

function normalizeDomains(domains: string[]): string[] {
  return domains
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain, index, all) => domain.length > 0 && all.indexOf(domain) === index)
}
