import * as React from 'react'
import * as Path from 'path'
import classNames from 'classnames'
import { DiffHeader } from '../diff/diff-header'
import {
  DiffSelection,
  DiffType,
  IDiff,
  ImageDiffType,
  ITextDiff,
} from '../../models/diff'
import {
  WorkingDirectoryFileChange,
  AppFileStatusKind,
} from '../../models/status'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { SeamlessDiffSwitcher } from '../diff/seamless-diff-switcher'
import { PopupType } from '../../models/popup'
import { FileEditor } from '../diff/file-editor'

interface IChangesProps {
  readonly repository: Repository
  readonly file: WorkingDirectoryFileChange
  readonly diff: IDiff | null
  readonly dispatcher: Dispatcher
  readonly imageDiffType: ImageDiffType

  /** Whether a commit is in progress */
  readonly isCommitting: boolean
  readonly hideWhitespaceInDiff: boolean

  /**
   * Called when the user requests to open a binary file in an the
   * system-assigned application for said file type.
   */
  readonly onOpenBinaryFile: (fullPath: string) => void

  /** Called when the user requests to open a submodule. */
  readonly onOpenSubmodule: (fullPath: string) => void

  /**
   * Called when the user is viewing an image diff and requests
   * to change the diff presentation mode.
   */
  readonly onChangeImageDiffType: (type: ImageDiffType) => void

  /**
   * Whether we should show a confirmation dialog when the user
   * discards changes
   */
  readonly askForConfirmationOnDiscardChanges: boolean

  /**
   * Whether we should display side by side diffs.
   */
  readonly showSideBySideDiff: boolean

  /** Whether or not to show the diff check marks indicating inclusion in a commit */
  readonly showDiffCheckMarks: boolean

  /** Called when the user opens the diff options popover */
  readonly onDiffOptionsOpened: () => void
}

/** How the changed file is presented in the changes view */
export type DiffViewMode = 'diff' | 'split' | 'edit'

interface IChangesState {
  /** Whether the selected file is currently open in the in-app editor */
  readonly viewMode: DiffViewMode
}

export class Changes extends React.Component<IChangesProps, IChangesState> {
  public constructor(props: IChangesProps) {
    super(props)

    this.state = { viewMode: 'diff' }
  }

  public componentDidUpdate(prevProps: IChangesProps) {
    if (
      prevProps.file.path !== this.props.file.path &&
      this.state.viewMode !== 'diff'
    ) {
      this.setState({ viewMode: 'diff' })
    }
  }

  /** Whether the currently selected file can be edited from within the app */
  private get canEdit() {
    const { file, diff } = this.props

    if (file.status.kind === AppFileStatusKind.Deleted) {
      return false
    }

    return (
      diff === null ||
      diff.kind === DiffType.Text ||
      diff.kind === DiffType.LargeText
    )
  }

  private onViewModeChanged = (viewMode: DiffViewMode) => {
    this.setState({ viewMode })
  }

  /** Whether the currently selected file may be added to .gitignore */
  private get canIgnore() {
    const { file } = this.props

    return (
      file.status.kind !== AppFileStatusKind.Deleted &&
      Path.basename(file.path) !== '.gitignore'
    )
  }

  private onIgnoreFile = async () => {
    try {
      await this.props.dispatcher.appendIgnoreFile(
        this.props.repository,
        this.props.file.path
      )
    } catch (error) {
      log.error('Failed to ignore file', error)
      await this.props.dispatcher.postError(error)
    }
  }

  private onCloseEditor = () => {
    this.setState({ viewMode: 'diff' })
  }

  private onFileSaved = () => {
    this.props.dispatcher.refreshRepository(this.props.repository)
  }

  /**
   * Whether or not it's currently possible to change the line selection
   * of a diff. Changing selection is not possible while a commit is in
   * progress or if the user has opted to hide whitespace changes.
   */
  private get lineSelectionDisabled() {
    return this.props.isCommitting || this.props.hideWhitespaceInDiff
  }

  private onDiffLineIncludeChanged = (selection: DiffSelection) => {
    if (!this.lineSelectionDisabled) {
      const { repository, file } = this.props
      this.props.dispatcher.changeFileLineSelection(repository, file, selection)
    }
  }

  private onDiscardChanges = (
    diff: ITextDiff,
    diffSelection: DiffSelection
  ) => {
    if (this.lineSelectionDisabled) {
      return
    }

    if (this.props.askForConfirmationOnDiscardChanges) {
      this.props.dispatcher.showPopup({
        type: PopupType.ConfirmDiscardSelection,
        repository: this.props.repository,
        file: this.props.file,
        diff,
        selection: diffSelection,
      })
    } else {
      this.props.dispatcher.discardChangesFromSelection(
        this.props.repository,
        this.props.file.path,
        diff,
        diffSelection
      )
    }
  }

  public render() {
    const { viewMode } = this.state

    return (
      <div className="diff-container">
        <DiffHeader
          path={this.props.file.path}
          status={this.props.file.status}
          diff={this.props.diff}
          showSideBySideDiff={this.props.showSideBySideDiff}
          onShowSideBySideDiffChanged={this.onShowSideBySideDiffChanged}
          hideWhitespaceInDiff={this.props.hideWhitespaceInDiff}
          onHideWhitespaceInDiffChanged={this.onHideWhitespaceInDiffChanged}
          onDiffOptionsOpened={this.props.onDiffOptionsOpened}
          canEdit={this.canEdit}
          viewMode={viewMode}
          onViewModeChanged={this.onViewModeChanged}
          onIgnoreFile={this.canIgnore ? this.onIgnoreFile : undefined}
        />

        <div
          className={classNames('diff-body', {
            'diff-split': viewMode === 'split',
          })}
        >
          {viewMode !== 'diff' && (
            <FileEditor
              repository={this.props.repository}
              filePath={this.props.file.path}
              onClose={this.onCloseEditor}
              onSaved={this.onFileSaved}
            />
          )}

          {viewMode !== 'edit' && (
            <SeamlessDiffSwitcher
              repository={this.props.repository}
              imageDiffType={this.props.imageDiffType}
              file={this.props.file}
              readOnly={false}
              onIncludeChanged={this.onDiffLineIncludeChanged}
              onDiscardChanges={this.onDiscardChanges}
              diff={this.props.diff}
              hideWhitespaceInDiff={this.props.hideWhitespaceInDiff}
              showSideBySideDiff={this.props.showSideBySideDiff}
              showDiffCheckMarks={this.props.showDiffCheckMarks}
              askForConfirmationOnDiscardChanges={
                this.props.askForConfirmationOnDiscardChanges
              }
              onOpenBinaryFile={this.props.onOpenBinaryFile}
              onOpenSubmodule={this.props.onOpenSubmodule}
              onChangeImageDiffType={this.props.onChangeImageDiffType}
              onHideWhitespaceInDiffChanged={this.onHideWhitespaceInDiffChanged}
            />
          )}
        </div>
      </div>
    )
  }

  private onShowSideBySideDiffChanged = (showSideBySideDiff: boolean) => {
    this.props.dispatcher.onShowSideBySideDiffChanged(showSideBySideDiff)
  }

  private onHideWhitespaceInDiffChanged = (hideWhitespaceInDiff: boolean) => {
    return this.props.dispatcher.onHideWhitespaceInChangesDiffChanged(
      hideWhitespaceInDiff,
      this.props.repository
    )
  }
}
