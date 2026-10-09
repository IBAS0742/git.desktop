import * as React from 'react'
import { mapStatus } from '../../lib/status'

import { CommittedFileChange } from '../../models/status'
import { ClickSource, List } from '../lib/list'
import { CommittedFileItem } from './committed-file-item'
import { buildFileTreeRows, IFileTreeRow } from '../lib/file-tree'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IFileListProps {
  readonly files: ReadonlyArray<CommittedFileChange>
  readonly selectedFile: CommittedFileChange | null
  readonly onSelectedFileChanged: (file: CommittedFileChange) => void
  readonly onRowDoubleClick: (row: number, source: ClickSource) => void
  readonly availableWidth: number
  readonly onContextMenu?: (
    file: CommittedFileChange,
    event: React.MouseEvent<HTMLDivElement>
  ) => void
}

interface IFileListState {
  readonly focusedRow: number | null
  readonly collapsedDirectories: ReadonlySet<string>
}

/**
 * Display a list of changed files as part of a commit or stash, grouped by
 * directory in a tree structure.
 */
export class FileList extends React.Component<IFileListProps, IFileListState> {
  public constructor(props: IFileListProps) {
    super(props)

    this.state = {
      focusedRow: null,
      collapsedDirectories: new Set<string>(),
    }
  }

  private getRows(): ReadonlyArray<IFileTreeRow<CommittedFileChange>> {
    return buildFileTreeRows(
      this.props.files,
      this.state.collapsedDirectories,
      f => f.path
    )
  }

  private onToggleDirectory = (path: string) => {
    const collapsedDirectories = new Set(this.state.collapsedDirectories)

    if (collapsedDirectories.has(path)) {
      collapsedDirectories.delete(path)
    } else {
      collapsedDirectories.add(path)
    }

    this.setState({ collapsedDirectories })
  }

  private onSelectedRowChanged = (row: number) => {
    const rows = this.getRows()
    const treeRow = rows[row]

    if (treeRow?.kind !== 'file' || treeRow.file === null) {
      return
    }

    this.props.onSelectedFileChanged(treeRow.file)
  }

  private renderDirectory = (row: IFileTreeRow<CommittedFileChange>) => {
    const isCollapsed = this.state.collapsedDirectories.has(row.path)

    return (
      <button
        type="button"
        className="file tree-directory"
        style={{ paddingLeft: `calc(var(--spacing) + ${row.depth * 16}px)` }}
        data-path={row.path}
        onClick={this.onDirectoryRowClick}
        aria-expanded={!isCollapsed}
      >
        <Octicon
          symbol={isCollapsed ? octicons.chevronRight : octicons.chevronDown}
          className="tree-toggle"
        />
        <Octicon
          symbol={octicons.fileDirectoryFill}
          className="tree-directory-icon"
        />
        <span className="tree-directory-name">{row.name}</span>
      </button>
    )
  }

  private onDirectoryRowClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const path = event.currentTarget.dataset['path']

    if (path !== undefined) {
      this.onToggleDirectory(path)
    }
  }

  private renderFile = (row: number) => {
    const treeRow = this.getRows()[row]

    if (treeRow === undefined) {
      return null
    }

    if (treeRow.kind === 'directory') {
      return this.renderDirectory(treeRow)
    }

    return (
      <CommittedFileItem
        file={treeRow.file!}
        availableWidth={this.props.availableWidth}
        focused={this.state.focusedRow === row}
        depth={treeRow.depth}
      />
    )
  }

  private selectedRowsForFile(): ReadonlyArray<number> {
    const { selectedFile } = this.props

    if (selectedFile === null) {
      return []
    }

    const rows = this.getRows()
    const rowIndex = rows.findIndex(
      r => r.kind === 'file' && r.path === selectedFile.path
    )

    return rowIndex >= 0 ? [rowIndex] : []
  }

  private onRowContextMenu = (
    row: number,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    const treeRow = this.getRows()[row]

    if (treeRow?.kind === 'file' && treeRow.file !== null) {
      this.props.onContextMenu?.(treeRow.file, event)
    }
  }

  private onRowDoubleClick = (row: number, source: ClickSource) => {
    const treeRow = this.getRows()[row]

    if (treeRow?.kind === 'file') {
      this.props.onRowDoubleClick(row, source)
    }
  }

  private canSelectRow = (row: number) => {
    return this.getRows()[row]?.kind === 'file'
  }

  private getFileAriaLabel = (row: number) => {
    const treeRow = this.getRows()[row]

    if (treeRow === undefined) {
      return ''
    }

    if (treeRow.kind === 'directory') {
      return `${treeRow.path} ${treeRow.kind}`
    }

    const { path, status } = treeRow.file!
    const fileStatus = mapStatus(status)
    return `${path} ${fileStatus}`
  }

  public render() {
    return (
      <div className="file-list">
        <List
          rowRenderer={this.renderFile}
          rowCount={this.getRows().length}
          rowHeight={29}
          selectedRows={this.selectedRowsForFile()}
          onSelectedRowChanged={this.onSelectedRowChanged}
          onRowDoubleClick={this.onRowDoubleClick}
          onRowContextMenu={this.onRowContextMenu}
          onRowKeyboardFocus={this.onRowFocus}
          onRowBlur={this.onRowBlur}
          canSelectRow={this.canSelectRow}
          getRowAriaLabel={this.getFileAriaLabel}
          invalidationProps={{ focusedRow: this.state.focusedRow }}
        />
      </div>
    )
  }

  private onRowFocus = (row: number) => {
    this.setState({ focusedRow: row })
  }

  private onRowBlur = (row: number) => {
    if (this.state.focusedRow === row) {
      this.setState({ focusedRow: null })
    }
  }
}
