import * as React from 'react'
import * as Path from 'path'
import { promises as fs } from 'fs'

import { highlight } from '../../lib/highlighter/worker'
import { ILineTokens, ITokens } from '../../lib/highlighter/types'
import { Repository } from '../../models/repository'
import { Button } from '../lib/button'
import { t } from '../../lib/i18n'

interface IFileEditorProps {
  readonly repository: Repository

  /** The repository relative path of the file being edited */
  readonly filePath: string

  /** Called when the user closes the editor without saving */
  readonly onClose: () => void

  /**
   * Called after the file has been written to disk so that the diff can be
   * refreshed.
   */
  readonly onSaved: () => void
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface IFileEditorState {
  readonly text: string
  readonly tokens: ITokens | null
  readonly saveState: SaveState
  readonly loadError: boolean

  /** Whether the file contents have been read from disk */
  readonly loaded: boolean
}

/** Delay (in milliseconds) before re-highlighting after a keystroke */
const HighlightDebounce = 250

/**
 * A minimal text editor used in place of the diff for a changed file.
 *
 * Highlighting is delegated to the same worker the diff uses so common file
 * types (js/ts, python, json, html, css, markdown, etc.) are covered.
 */
export class FileEditor extends React.Component<
  IFileEditorProps,
  IFileEditorState
> {
  private highlightTimeout: number | null = null
  private textarea: HTMLTextAreaElement | null = null
  private highlight: HTMLPreElement | null = null
  private originalText: string
  private eol: string

  public constructor(props: IFileEditorProps) {
    super(props)

    this.originalText = ''
    this.eol = '\n'

    this.state = {
      text: '',
      tokens: null,
      saveState: 'idle',
      loadError: false,
      loaded: false,
    }
  }

  private get fullPath() {
    return Path.join(this.props.repository.path, this.props.filePath)
  }

  public componentDidMount() {
    this.loadContents()
  }

  private async loadContents() {
    try {
      const text = await fs.readFile(this.fullPath, { encoding: 'utf8' })

      this.originalText = text
      this.eol = text.includes('\r\n') ? '\r\n' : '\n'

      this.setState({ text, loaded: true }, () => {
        if (this.textarea !== null) {
          this.textarea.focus()
          this.textarea.setSelectionRange(0, 0)
        }
      })

      this.scheduleHighlight(text)
    } catch (e) {
      this.setState({ loadError: true })
    }
  }

  public componentWillUnmount() {
    if (this.highlightTimeout !== null) {
      window.clearTimeout(this.highlightTimeout)
    }
  }

  private scheduleHighlight(text: string) {
    if (this.highlightTimeout !== null) {
      window.clearTimeout(this.highlightTimeout)
    }

    this.highlightTimeout = window.setTimeout(() => {
      this.highlightTimeout = null
      this.performHighlight(text)
    }, HighlightDebounce)
  }

  private async performHighlight(text: string) {
    const lines = text.split('\n')

    try {
      const tokens = await highlight(
        lines,
        Path.basename(this.props.filePath),
        Path.extname(this.props.filePath),
        4,
        lines.map((_, i) => i)
      )

      // The user may have typed in the meantime, in which case the tokens are
      // stale and another highlight has already been scheduled.
      if (text === this.state.text) {
        this.setState({ tokens })
      }
    } catch (e) {
      // Highlighting is best effort, the editor stays usable without it.
      if (text === this.state.text) {
        this.setState({ tokens: null })
      }
    }
  }

  private onTextChanged = (event: React.FormEvent<HTMLTextAreaElement>) => {
    const text = event.currentTarget.value

    this.setState(state => ({
      text,
      saveState: state.saveState === 'saved' ? 'idle' : state.saveState,
    }))

    this.scheduleHighlight(text)
  }

  private onScroll = () => {
    if (this.textarea === null || this.highlight === null) {
      return
    }

    this.highlight.scrollLeft = this.textarea.scrollLeft
    this.highlight.scrollTop = this.textarea.scrollTop
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      this.onSave()
    }
  }

  private onSave = () => {
    if (
      this.state.loadError ||
      !this.state.loaded ||
      this.state.saveState === 'saving'
    ) {
      return
    }

    const { text } = this.state
    const contents =
      this.eol === '\r\n' && !text.includes('\r')
        ? text.replace(/\n/g, '\r\n')
        : text

    this.setState({ saveState: 'saving' })

    fs.writeFile(this.fullPath, contents, { encoding: 'utf8' })
      .then(() => {
        this.originalText = text
        this.setState({ saveState: 'saved' })
        this.props.onSaved()
      })
      .catch(() => {
        this.setState({ saveState: 'error' })
      })
  }

  private onClose = () => {
    this.props.onClose()
  }

  private renderLine(line: string, lineTokens: ILineTokens | undefined) {
    if (lineTokens === undefined) {
      return line
    }

    const starts = Object.keys(lineTokens)
      .map(Number)
      .sort((a, b) => a - b)

    const elements = new Array<React.ReactNode>()
    let position = 0
    let key = 0

    for (const start of starts) {
      if (start > position) {
        elements.push(line.slice(position, start))
      }

      const { length, token } = lineTokens[start]
      elements.push(
        <span key={`t${key++}`} className={`cm-${token}`}>
          {line.slice(start, start + length)}
        </span>
      )

      position = Math.max(position, start + length)
    }

    if (position < line.length) {
      elements.push(line.slice(position))
    }

    return elements
  }

  private renderHighlight() {
    const { text, tokens } = this.state
    const lines = text.split('\n')

    return (
      <pre
        className="file-editor-highlight"
        aria-hidden={true}
        ref={this.onHighlightRef}
      >
        {lines.map((line, index) => (
          <React.Fragment key={index}>
            {this.renderLine(line, tokens?.[index])}
            {index < lines.length - 1 ? '\n' : ''}
          </React.Fragment>
        ))}
      </pre>
    )
  }

  private onTextareaRef = (element: HTMLTextAreaElement | null) => {
    this.textarea = element
  }

  private onHighlightRef = (element: HTMLPreElement | null) => {
    this.highlight = element
  }

  private renderSaveLabel() {
    switch (this.state.saveState) {
      case 'saving':
        return t('diff.saving')
      case 'saved':
        return t('diff.saved')
      case 'error':
        return t('diff.saveFailed')
      default:
        return t('diff.save')
    }
  }

  public render() {
    if (this.state.loadError) {
      return (
        <div className="file-editor">
          <div className="file-editor-toolbar">
            <Button onClick={this.onClose}>{t('diff.closeEditor')}</Button>
          </div>
          <div className="file-editor-error">{t('diff.cannotOpen')}</div>
        </div>
      )
    }

    const isDirty = this.state.text !== this.originalText

    return (
      <div className="file-editor cm-s-default">
        <div className="file-editor-toolbar">
          <span className="file-editor-hint">{t('diff.editHint')}</span>
          <Button onClick={this.onClose}>{t('diff.closeEditor')}</Button>
          <Button
            className="file-editor-save"
            onClick={this.onSave}
            disabled={!isDirty && this.state.saveState !== 'error'}
          >
            {this.renderSaveLabel()}
          </Button>
        </div>
        <div className="file-editor-body">
          {this.renderHighlight()}
          <textarea
            className="file-editor-input"
            ref={this.onTextareaRef}
            value={this.state.text}
            onChange={this.onTextChanged}
            onScroll={this.onScroll}
            onKeyDown={this.onKeyDown}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
          />
        </div>
      </div>
    )
  }
}
