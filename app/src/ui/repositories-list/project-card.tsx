import * as React from 'react'

import { Repository } from '../../models/repository'
import { Octicon, OcticonSymbol } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { TextBox } from '../lib/text-box'
import { Button } from '../lib/button'
import { t } from '../../lib/i18n'
import {
  getRepositoryMetadata,
  setRepositoryMetadata,
  IRepositoryMetadata,
} from '../../lib/repository-metadata'

/** The symbols a user can pick from when customizing a project icon */
export const ProjectSymbolNames: ReadonlyArray<string> = [
  'repo',
  'book',
  'code',
  'star',
  'heart',
  'zap',
  'bug',
  'terminal',
  'globe',
  'rocket',
  'shield',
  'gear',
  'database',
  'paintbrush',
  'beaker',
  'tools',
]

const SymbolLookup: Record<string, OcticonSymbol> = {
  repo: octicons.repo,
  book: octicons.book,
  code: octicons.code,
  star: octicons.star,
  heart: octicons.heart,
  zap: octicons.zap,
  bug: octicons.bug,
  terminal: octicons.terminal,
  globe: octicons.globe,
  rocket: octicons.rocket,
  shield: octicons.shield,
  gear: octicons.gear,
  database: octicons.database,
  paintbrush: octicons.paintbrush,
  beaker: octicons.beaker,
  tools: octicons.tools,
}

/** The colors a user can pick from when customizing a project icon */
export const ProjectColors: ReadonlyArray<string> = [
  '#0969da',
  '#1f883d',
  '#bf8700',
  '#e16f24',
  '#cf222e',
  '#8250df',
  '#1b7c83',
  '#57606a',
]

/** Look up the icon symbol for a given symbol name, falling back to a repo */
export function getProjectSymbol(name: string | null): OcticonSymbol {
  return (name !== null ? SymbolLookup[name] : undefined) ?? octicons.repo
}

interface IProjectCardProps {
  readonly repository: Repository
}

interface IProjectCardState {
  readonly editing: boolean
}

/**
 * Shows the currently selected project together with its (user editable)
 * description and icon. The card doubles as the editor for that metadata.
 */
export class ProjectCard extends React.Component<
  IProjectCardProps,
  IProjectCardState
> {
  public constructor(props: IProjectCardProps) {
    super(props)

    this.state = { editing: false }
  }

  private get metadata() {
    return getRepositoryMetadata(this.props.repository.id)
  }

  private onUpdate = (patch: Partial<IRepositoryMetadata>) => {
    setRepositoryMetadata(this.props.repository.id, {
      ...this.metadata,
      ...patch,
    })
  }

  private onDescriptionChanged = (value: string) => {
    this.onUpdate({ description: value })
  }

  private onToggleEditing = () => {
    this.setState({ editing: !this.state.editing })
  }

  private onSymbolClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const symbol = event.currentTarget.dataset['symbol']

    if (symbol !== undefined) {
      this.onUpdate({ symbol })
    }
  }

  private onColorClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const color = event.currentTarget.dataset['color']

    if (color !== undefined) {
      this.onUpdate({ color })
    }
  }

  private renderIcon() {
    const { symbol, color } = this.metadata

    return (
      <div
        className="project-card-icon"
        style={{ backgroundColor: color ?? 'var(--box-background-color)' }}
      >
        <Octicon symbol={getProjectSymbol(symbol)} />
      </div>
    )
  }

  private renderSymbolPicker() {
    const { symbol } = this.metadata

    return (
      <div className="project-card-picker" role="listbox">
        <div className="project-card-picker-label">{t('project.icon')}</div>
        <div className="project-card-swatches">
          {ProjectSymbolNames.map(name => (
            <button
              key={name}
              type="button"
              className={
                'project-card-symbol' + (symbol === name ? ' selected' : '')
              }
              data-symbol={name}
              onClick={this.onSymbolClick}
              aria-label={name}
              aria-selected={symbol === name}
              role="option"
            >
              <Octicon symbol={getProjectSymbol(name)} />
            </button>
          ))}
        </div>
      </div>
    )
  }

  private renderColorPicker() {
    const { color } = this.metadata

    return (
      <div className="project-card-picker" role="listbox">
        <div className="project-card-picker-label">{t('project.color')}</div>
        <div className="project-card-swatches">
          {ProjectColors.map(value => (
            <button
              key={value}
              type="button"
              className={
                'project-card-color' + (color === value ? ' selected' : '')
              }
              style={{ backgroundColor: value }}
              data-color={value}
              onClick={this.onColorClick}
              aria-label={value}
              aria-selected={color === value}
              role="option"
            />
          ))}
        </div>
      </div>
    )
  }

  public render() {
    const { repository } = this.props
    const { description } = this.metadata
    const { editing } = this.state

    const name = repository.alias ?? repository.name

    return (
      <div className="project-card">
        <div className="project-card-header">
          {this.renderIcon()}
          <div className="project-card-titles">
            <div className="project-card-name">{name}</div>
            {!editing && (
              <div
                className={
                  'project-card-description' +
                  (description === '' ? ' empty' : '')
                }
              >
                {description === ''
                  ? t('project.descriptionPlaceholder')
                  : description}
              </div>
            )}
          </div>
          <Button className="project-card-edit" onClick={this.onToggleEditing}>
            {editing ? t('project.done') : t('project.edit')}
          </Button>
        </div>

        {editing && (
          <div className="project-card-editor">
            <div className="project-card-picker">
              <div className="project-card-picker-label">
                {t('project.description')}
              </div>
              <TextBox
                value={description}
                placeholder={t('project.descriptionPlaceholder')}
                onValueChanged={this.onDescriptionChanged}
              />
            </div>
            {this.renderSymbolPicker()}
            {this.renderColorPicker()}
          </div>
        )}
      </div>
    )
  }
}
