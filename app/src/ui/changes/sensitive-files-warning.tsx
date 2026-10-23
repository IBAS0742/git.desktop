import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { PathText } from '../lib/path-text'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { ICommitContext } from '../../models/commit'
import { DefaultCommitMessage } from '../../models/commit-message'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import {
  ISensitiveFileMatch,
  setSensitiveScanOptedOut,
} from '../../lib/sensitive-files'
import { t, TranslationKey } from '../../lib/i18n'

interface ISensitiveFilesWarningProps {
  readonly matches: ReadonlyArray<ISensitiveFileMatch>
  readonly repository: Repository
  readonly context: ICommitContext
  readonly onDismissed: () => void
  readonly dispatcher: Dispatcher
}

interface ISensitiveFilesWarningState {
  /** Whether the user ticked "don't ask again for this project" */
  readonly dontAskAgain: boolean
}

/**
 * A dialog which shows the files about to be committed that matched the
 * default list of sensitive file types and folders, giving the user a chance
 * to review them (or opt out for this project) before the commit goes through.
 */
export class SensitiveFilesWarning extends React.Component<
  ISensitiveFilesWarningProps,
  ISensitiveFilesWarningState
> {
  public constructor(props: ISensitiveFilesWarningProps) {
    super(props)

    this.state = { dontAskAgain: false }
  }

  public render() {
    return (
      <Dialog
        id="sensitive-files-warning"
        title={t('sensitive.title')}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        type="warning"
      >
        <DialogContent>
          <p>{t('sensitive.description')}</p>
          {this.renderFileList()}
          <Checkbox
            value={
              this.state.dontAskAgain ? CheckboxValue.On : CheckboxValue.Off
            }
            onChange={this.onDontAskAgainChanged}
            label={t('sensitive.dontAskAgain')}
            className="sensitive-dont-ask-again"
          />
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            destructive={true}
            okButtonText={t('sensitive.commitAnyway')}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private renderFileList() {
    return (
      <div className="files-list">
        <ul>
          {this.props.matches.map(match => (
            <li key={match.path}>
              <PathText path={match.path} />
              <span className="sensitive-reason">
                {t(`sensitive.reason.${match.reason}` as TranslationKey)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  private onDontAskAgainChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.setState({ dontAskAgain: event.currentTarget.checked })
  }

  private onSubmit = async () => {
    if (this.state.dontAskAgain) {
      setSensitiveScanOptedOut(this.props.repository.id)
    }

    this.props.onDismissed()

    await this.props.dispatcher.commitIncludedChanges(
      this.props.repository,
      this.props.context
    )

    this.props.dispatcher.setCommitMessage(
      this.props.repository,
      DefaultCommitMessage
    )
  }
}
