import assert from 'node:assert'
import { afterEach, describe, it } from 'node:test'

import {
  LanguageNames,
  getLanguage,
  setLanguage,
  t,
  TranslationKey,
} from '../../src/lib/i18n'

// The dictionaries are intentionally kept private but we can still assert
// that both languages cover the same set of keys by looking at the shape of
// the translations for a handful of known keys.
const sampleKeys: ReadonlyArray<TranslationKey> = [
  'toolbar.language',
  'tab.changes',
  'tab.history',
  'commit.commit',
  'changes.filter',
  'diff.edit',
  'project.edit',
]

describe('i18n', () => {
  afterEach(() => {
    setLanguage('en')
  })

  it('defaults to English', () => {
    setLanguage('en')
    assert.strictEqual(getLanguage(), 'en')
    assert.strictEqual(t('tab.changes'), 'Changes')
  })

  it('switches to Chinese', () => {
    setLanguage('zh')
    assert.strictEqual(getLanguage(), 'zh')
    assert.strictEqual(t('tab.changes'), '变更')
    assert.strictEqual(t('tab.history'), '历史')
    assert.strictEqual(t('toolbar.language'), '语言')
  })

  it('exposes a display name for every language', () => {
    assert.strictEqual(LanguageNames.en, 'English')
    assert.strictEqual(LanguageNames.zh, '中文')
  })

  it('interpolates parameters', () => {
    setLanguage('en')
    assert.strictEqual(
      t('commit.action', { verb: 'Commit', files: '3 files ' }),
      'Commit 3 files to '
    )

    setLanguage('zh')
    assert.strictEqual(
      t('commit.action', { verb: '提交', files: '3 个文件 ' }),
      '提交3 个文件 到 '
    )
    assert.strictEqual(t('commit.fileCountMany', { count: 5 }), '5 个文件')
  })

  it('translates every sampled key in both languages', () => {
    for (const key of sampleKeys) {
      setLanguage('en')
      const english = t(key)
      setLanguage('zh')
      const chinese = t(key)

      assert.notStrictEqual(english, '', `missing English translation: ${key}`)
      assert.notStrictEqual(chinese, '', `missing Chinese translation: ${key}`)
      assert.notStrictEqual(
        english,
        chinese,
        `Chinese translation falls back to English: ${key}`
      )
    }
  })

  it('persists the language selection', () => {
    setLanguage('zh')
    assert.strictEqual(localStorage.getItem('github-desktop-language'), 'zh')

    setLanguage('en')
    assert.strictEqual(localStorage.getItem('github-desktop-language'), 'en')
  })
})
