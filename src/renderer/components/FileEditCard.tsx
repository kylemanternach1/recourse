import type { FileEditRecord } from '../../shared/contracts'
import { LineDiffView } from './LineDiffView'

function editTitle(kind: FileEditRecord['kind'], replacements?: number): string {
  switch (kind) {
    case 'create':
      return 'Created file'
    case 'overwrite':
      return 'Updated file'
    case 'patch':
      return replacements && replacements > 1
        ? `Edited file · ${replacements} replacements`
        : 'Edited file'
    default:
      return 'Edited file'
  }
}

export function FileEditCard({ edit }: { edit: FileEditRecord }): JSX.Element {
  const hasDiff =
    (edit.oldText != null && edit.oldText.length > 0) ||
    (edit.newText != null && edit.newText.length > 0)

  return (
    <>
      <div className="msg-avatar file-tool-avatar file-tool-avatar--edit" aria-hidden>
        ✎
      </div>
      <div className="file-tool-card file-tool-card--edit">
        <p className="file-tool-label">{editTitle(edit.kind, edit.replacements)}</p>
        <p className="file-tool-path" title={edit.path}>
          {edit.path}
        </p>
        {edit.truncated ? (
          <p className="file-tool-meta">Diff preview truncated</p>
        ) : null}
        {hasDiff ? (
          <LineDiffView oldText={edit.oldText ?? ''} newText={edit.newText ?? ''} />
        ) : (
          <p className="file-tool-empty">
            {edit.kind === 'patch'
              ? 'Patch applied — diff preview wasn\u2019t stored for this edit.'
              : edit.kind === 'create'
                ? 'File created — contents weren\u2019t stored for this session.'
                : 'File updated — diff preview wasn\u2019t stored for this edit.'}
          </p>
        )}
      </div>
    </>
  )
}
