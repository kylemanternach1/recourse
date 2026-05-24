import path from 'node:path'
import { app } from 'electron'

/** Layout of the project-local runtime that `scripts/sync-skills.sh` builds. */
export interface SkillRuntimePaths {
  /** Root of the runtime tree (e.g. <repo>/.recourse-runtime). */
  root: string
  /** Python venv directory, or undefined if it hasn't been created yet. */
  venvDir: string
  /** Python venv bin directory (where `python` and pip-installed scripts live). */
  venvBin: string
  /** Node.js packages directory (project-local "global" install). */
  nodeRoot: string
  /** node_modules/.bin from the local node install. */
  nodeBin: string
}

/** Returns the directory where the runtime should live. In dev this resolves to
 *  the workspace root; when packaged it falls back to the userData folder so the
 *  read-only app bundle isn't written to. */
export function resolveRuntimeRoot(): string {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), '.recourse-runtime')
  }
  return path.join(app.getPath('userData'), 'runtime')
}

export function resolveRuntimePaths(): SkillRuntimePaths {
  const root = resolveRuntimeRoot()
  const venvDir = path.join(root, 'python', 'venv')
  const venvBin = path.join(venvDir, 'bin')
  const nodeRoot = path.join(root, 'node')
  const nodeBin = path.join(nodeRoot, 'node_modules', '.bin')
  return { root, venvDir, venvBin, nodeRoot, nodeBin }
}

/** Prepend the runtime bins to a PATH-like string. Earlier wins. */
export function prependRuntimePath(existingPath: string | undefined): string {
  const { venvBin, nodeBin } = resolveRuntimePaths()
  const prefix = [venvBin, nodeBin].join(path.delimiter)
  if (!existingPath || existingPath.length === 0) {
    return prefix
  }
  return `${prefix}${path.delimiter}${existingPath}`
}
