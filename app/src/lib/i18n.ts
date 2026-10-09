import { getEnum } from './local-storage'

export type SupportedLanguage = 'en' | 'zh'

const SupportedLanguages: Record<string, SupportedLanguage> = {
  en: 'en',
  zh: 'zh',
}

/** The display names of every supported language, shown as-is in the UI */
export const LanguageNames: Record<SupportedLanguage, string> = {
  en: 'English',
  zh: '中文',
}

const LanguageStorageKey = 'github-desktop-language'

const en = {
  'toolbar.currentRepository': 'Current repository',
  'toolbar.selectRepository': 'Select a repository',
  'toolbar.noRepositories': 'No repositories',
  'toolbar.language': 'Language',

  'tab.changes': 'Changes',
  'tab.history': 'History',

  'commit.summary': 'Summary',
  'commit.summaryRequired': 'Summary (required)',
  'commit.description': 'Description',
  'commit.commit': 'Commit',
  'commit.committing': 'Committing',
  'commit.amend': 'Amend',
  'commit.amending': 'Amending',
  'commit.action': '{verb} {files}to ',
  'commit.fileCountOne': '{count} file',
  'commit.fileCountMany': '{count} files',

  'changes.filter': 'Filter',
  'changes.fileSingular': 'changed file',
  'changes.filePlural': 'changed files',
  'changes.stashedChanges': 'Stashed Changes',
  'changes.noFilesMatch': 'No files match your current filters',
  'changes.clearFilters': 'Clear filters',
  'changes.refresh': 'Refresh',

  'diff.showDiff': 'Show diff',
  'diff.fileEmpty': 'The file is empty',
  'diff.edit': 'Edit',
  'diff.editing': 'Editing',
  'diff.ignore': 'Ignore',
  'diff.modeDiff': 'Diff',
  'diff.modeSplit': 'Split',

  'sensitive.title': 'Potentially sensitive files',
  'sensitive.description':
    'The files about to be committed match patterns that often contain secrets or environment-specific configuration. Please review them before committing:',
  'sensitive.dontAskAgain': "Don't ask again for this project",
  'sensitive.commitAnyway': 'Commit anyway',
  'sensitive.reason.env': 'Environment configuration file',
  'sensitive.reason.key': 'Private key or certificate file',
  'sensitive.reason.credential': 'Credential or secret file',
  'sensitive.reason.folder': 'Sensitive folder',
  'sensitive.reason.deps': 'Dependency folder',

  'diff.save': 'Save',
  'diff.saving': 'Saving…',
  'diff.saved': 'Saved',
  'diff.saveFailed': 'Unable to save the file',
  'diff.editHint': 'Edit the file contents directly. Press Ctrl+S to save.',
  'diff.cannotOpen': 'Unable to open this file for editing',
  'diff.closeEditor': 'Close editor',

  'project.edit': 'Edit project',
  'project.description': 'Description',
  'project.descriptionPlaceholder': 'Describe this project…',
  'project.icon': 'Icon',
  'project.color': 'Color',
  'project.done': 'Done',
  'project.currentProject': 'Current project',
} as const

export type TranslationKey = keyof typeof en

const zh: Record<TranslationKey, string> = {
  'toolbar.currentRepository': '当前仓库',
  'toolbar.selectRepository': '选择仓库',
  'toolbar.noRepositories': '没有仓库',
  'toolbar.language': '语言',

  'tab.changes': '变更',
  'tab.history': '历史',

  'commit.summary': '摘要',
  'commit.summaryRequired': '摘要（必填）',
  'commit.description': '描述',
  'commit.commit': '提交',
  'commit.committing': '提交中',
  'commit.amend': '修补',
  'commit.amending': '修补中',
  'commit.action': '{verb}{files}到 ',
  'commit.fileCountOne': '{count} 个文件',
  'commit.fileCountMany': '{count} 个文件',

  'changes.filter': '筛选',
  'changes.fileSingular': '个变更文件',
  'changes.filePlural': '个变更文件',
  'changes.stashedChanges': '已贮存的更改',
  'changes.noFilesMatch': '没有文件符合当前的筛选条件',
  'changes.clearFilters': '清除筛选',
  'changes.refresh': '刷新',

  'diff.showDiff': '显示差异',
  'diff.fileEmpty': '文件为空',
  'diff.edit': '编辑',
  'diff.editing': '编辑中',
  'diff.ignore': '忽略',
  'diff.modeDiff': '对比',
  'diff.modeSplit': '同屏',

  'sensitive.title': '可能包含敏感信息的文件',
  'sensitive.description':
    '本次提交的内容中有以下文件命中了常用于存放密钥或环境配置的规则，请在提交前确认：',
  'sensitive.dontAskAgain': '当前项目不再询问',
  'sensitive.commitAnyway': '仍然提交',
  'sensitive.reason.env': '环境配置文件',
  'sensitive.reason.key': '私钥或证书文件',
  'sensitive.reason.credential': '凭据或密钥文件',
  'sensitive.reason.folder': '敏感目录',
  'sensitive.reason.deps': '依赖目录',

  'diff.save': '保存',
  'diff.saving': '保存中…',
  'diff.saved': '已保存',
  'diff.saveFailed': '无法保存该文件',
  'diff.editHint': '可直接编辑文件内容，按 Ctrl+S 保存。',
  'diff.cannotOpen': '无法打开该文件进行编辑',
  'diff.closeEditor': '关闭编辑器',

  'project.edit': '编辑项目',
  'project.description': '描述',
  'project.descriptionPlaceholder': '给这个项目写一句简介…',
  'project.icon': '图标',
  'project.color': '颜色',
  'project.done': '完成',
  'project.currentProject': '当前项目',
}

let currentLanguage: SupportedLanguage =
  getEnum(LanguageStorageKey, SupportedLanguages) ?? 'en'

/** The language currently used to render the interface */
export function getLanguage(): SupportedLanguage {
  return currentLanguage
}

/** Change the language used to render the interface */
export function setLanguage(language: SupportedLanguage) {
  currentLanguage = language
  localStorage.setItem(LanguageStorageKey, language)
}

/**
 * Translate the given key using the current language.
 *
 * Unknown parameters are left untouched and missing interpolations are simply
 * not rendered.
 */
export function t(
  key: TranslationKey,
  params?: Readonly<Record<string, string | number>>
): string {
  const templates = currentLanguage === 'zh' ? zh : en
  let text = templates[key] ?? en[key]

  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value))
    }
  }

  return text
}
