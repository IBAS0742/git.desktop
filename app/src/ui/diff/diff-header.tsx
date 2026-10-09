import * as React from 'react'
import classNames from 'classnames'
import { PathLabel } from '../lib/path-label'
import { AppFileStatus } from '../../models/status'
import { IDiff, DiffType } from '../../models/diff'
import { Octicon, iconForStatus } from '../octicons'
import { mapStatus } from '../../lib/status'
import { DiffOptions } from './diff-options'
import { Button } from '../lib/button'
import { t } from '../../lib/i18n'

interface IDiffHeaderProps {
  readonly path: string
  readonly status: AppFileStatus
  readonly diff: IDiff | null

  /** Whether we should display side by side diffs. */
  readonly showSideBySideDiff: boolean

  /** Called when the user changes the side by side diffs setting. */
  readonly onShowSideBySideDiffChanged: (checked: boolean) => void

  /** Whether we should hide whitespace in diffs. */
  readonly hideWhitespaceInDiff: boolean

  /** Called when the user changes the hide whitespace in diffs setting. */
  readonly onHideWhitespaceInDiffChanged: (checked: boolean) => Promise<void>

  /** Called when the user opens the diff options popover */
  readonly onDiffOptionsOpened: () => void

  /** Whether the file can be edited in-app, defaults to false */
  readonly canEdit?: boolean

  /** How the file is currently presented (diff, split or editor) */
  readonly viewMode?: 'diff' | 'split' | 'edit'

  /** Called when the user switches the presentation of the file */
  readonly onViewModeChanged?: (mode: 'diff' | 'split' | 'edit') => void

  /**
   * Called when the user wants to add the file to .gitignore. Only provided
   * when ignoring is possible for the current file.
   */
  readonly onIgnoreFile?: () => void
}

/** Displays information about a file */
export class DiffHeader extends React.Component<IDiffHeaderProps, {}> {
  public render() {
    const status = this.props.status
    const fileStatus = mapStatus(status)

    return (
      <div className="header">
        <PathLabel path={this.props.path} status={this.props.status} />

        {this.renderActions()}

        {this.renderDiffOptions()}

        <Octicon
          symbol={iconForStatus(status)}
          className={'status status-' + fileStatus.toLowerCase()}
          title={fileStatus}
        />
      </div>
    )
  }

  /** The ignore button and view switch, grouped and pushed to the right */
  private renderActions() {
    const ignoreButton = this.renderIgnoreButton()
    const viewModeSwitch = this.renderViewModeSwitch()

    if (ignoreButton === null && viewModeSwitch === null) {
      return null
    }

    return (
      <div className="header-actions">
        {ignoreButton}
        {viewModeSwitch}
      </div>
    )
  }

  private renderIgnoreButton() {
    if (this.props.onIgnoreFile === undefined) {
      return null
    }

    return (
      <Button className="diff-ignore-button" onClick={this.props.onIgnoreFile}>
        {t('diff.ignore')}
      </Button>
    )
  }

  private renderViewModeSwitch() {
    if (!this.props.canEdit || this.props.onViewModeChanged === undefined) {
      return null
    }

    const modes: ReadonlyArray<{
      mode: 'diff' | 'split' | 'edit'
      label: string
    }> = [
      { mode: 'diff', label: t('diff.modeDiff') },
      { mode: 'split', label: t('diff.modeSplit') },
      { mode: 'edit', label: t('diff.edit') },
    ]

    return (
      <div className="diff-view-switch" role="group">
        {modes.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            className={classNames('diff-view-switch-button', {
              active: (this.props.viewMode ?? 'diff') === mode,
            })}
            aria-pressed={(this.props.viewMode ?? 'diff') === mode}
            data-mode={mode}
            onClick={this.onViewModeClick}
          >
            {label}
          </button>
        ))}
      </div>
    )
  }

  private onViewModeClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const mode = event.currentTarget.dataset['mode']

    if (mode === 'diff' || mode === 'split' || mode === 'edit') {
      this.props.onViewModeChanged?.(mode)
    }
  }

  private renderDiffOptions() {
    if (this.props.diff?.kind === DiffType.Submodule) {
      return null
    }

    return (
      <DiffOptions
        isInteractiveDiff={true}
        onHideWhitespaceChangesChanged={
          this.props.onHideWhitespaceInDiffChanged
        }
        hideWhitespaceChanges={this.props.hideWhitespaceInDiff}
        onShowSideBySideDiffChanged={this.props.onShowSideBySideDiffChanged}
        showSideBySideDiff={this.props.showSideBySideDiff}
        onDiffOptionsOpened={this.props.onDiffOptionsOpened}
      />
    )
  }
}
