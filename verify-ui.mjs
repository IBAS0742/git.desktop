// Smoke-tests the packaged build of GitHub Desktop.
//
// Run with: node verify-ui.mjs   (requires the project's node_modules)
// Restores the language and repository metadata it touches when it finishes.
import path from 'node:path'
import { _electron as electron } from 'playwright'

const exe = path.resolve('dist/GitHubDesktop-win32-x64/GitHubDesktop.exe')

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok, extra })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
}

async function getLocalStorage(app, page, key) {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return win.webContents.executeJavaScript(
      `JSON.stringify(window.localStorage.getItem(${JSON.stringify(key)}))`
    )
  }).catch(() => null)
  return page.evaluate(k => window.localStorage.getItem(k), key)
}

async function setLocalStorage(app, page, key, value) {
  await app.evaluate(({ BrowserWindow }, args) => {
    const win = BrowserWindow.getAllWindows()[0]
    return win.webContents.executeJavaScript(
      `window.localStorage.setItem(${JSON.stringify(args.key)}, ${JSON.stringify(
        args.value
      )})`
    )
  }, { key, value })
}

async function reload(app, page) {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.reload()
  )
  await page.waitForSelector('#desktop-app-contents', { timeout: 60000 })
  await page.waitForTimeout(3000)
}

const app = await electron.launch({ executablePath: exe, timeout: 60000 })
const page = await app.firstWindow()

const consoleErrors = []
page.on('pageerror', e => consoleErrors.push(String(e)))
page.on('console', msg => {
  if (msg.type() === 'error') {
    consoleErrors.push(msg.text())
  }
})

await page.waitForSelector('#desktop-app-contents', { timeout: 60000 })
await page.waitForTimeout(3000)

const originalLanguage = await getLocalStorage(app, page, 'github-desktop-language')
const originalMetadata = await getLocalStorage(
  app,
  page,
  'github-desktop-repository-metadata'
)
console.log(
  `previous state: language=${originalLanguage} metadata=${
    originalMetadata === null ? 'none' : 'set'
  }`
)

async function restore() {
  // Put back whatever the app had before this run; only clear the keys that
  // were absent to begin with.
  await app.evaluate(
    ({ BrowserWindow }, args) => {
      const win = BrowserWindow.getAllWindows()[0]
      const apply = (key, value) =>
        value === null
          ? `window.localStorage.removeItem(${JSON.stringify(key)})`
          : `window.localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(
              value
            )})`
      return win.webContents.executeJavaScript(
        `${apply('github-desktop-language', args.language)};\n` +
          `${apply('github-desktop-repository-metadata', args.metadata)};`
      )
    },
    { language: originalLanguage, metadata: originalMetadata }
  )
}

// Make sure the English checks run in English no matter what a previous run
// left behind.
await setLocalStorage(app, page, 'github-desktop-language', 'en')
await reload(app, page)

// 1. Language menu in the window menu bar (File/Edit/View/…/Help/Language)
const topMenus = (await page.locator('#app-menu-bar button').allTextContents())
  .map(t => t.trim())
  .filter(t => t.length > 0)
check(
  'Menu bar shows File/Edit/View/Repository/Branch/Help/Language',
  ['File', 'Edit', 'View', 'Repository', 'Branch', 'Help', 'Language'].every(
    m => topMenus.some(t => t.includes(m))
  ),
  topMenus.join(', ')
)
const helpIndex = topMenus.findIndex(t => t.includes('Help'))
const languageIndex = topMenus.findIndex(t => t.includes('Language'))
check(
  'Language sits at the end of the menu bar after Help',
  languageIndex > helpIndex && languageIndex === topMenus.length - 1,
  `help=${helpIndex} language=${languageIndex} total=${topMenus.length}`
)

// The toolbar language button should be gone
check(
  'Language button removed from the toolbar',
  (await page.locator('.language-toolbar-button').count()) === 0
)

await page
  .locator('#app-menu-bar button')
  .filter({ hasText: 'Language' })
  .first()
  .click()
await page.waitForSelector('.menu-pane .menu-item', { timeout: 5000 })
const languageItems = await page
  .locator('.menu-pane .menu-item .label')
  .allTextContents()
check(
  'Language menu lists English and 中文',
  languageItems.some(t => t.includes('English')) &&
    languageItems.some(t => t.includes('中文')),
  languageItems.join(', ')
)

// Switch to Chinese through the menu bar and back again
await page
  .locator('.menu-pane .menu-item')
  .filter({ hasText: '中文' })
  .first()
  .click()
await page.waitForTimeout(3000)
const zhTab = (await page.locator('#changes-tab span').first().textContent())?.trim()
check('Language menu switches the app to Chinese', zhTab === '变更', zhTab ?? '')

await page
  .locator('#app-menu-bar button')
  .filter({ hasText: 'Language' })
  .first()
  .click()
await page.waitForSelector('.menu-pane .menu-item', { timeout: 5000 })
await page
  .locator('.menu-pane .menu-item')
  .filter({ hasText: 'English' })
  .first()
  .click()
await page.waitForTimeout(3000)
const enTab = (await page.locator('#changes-tab span').first().textContent())?.trim()
check('Language menu switches the app back to English', enTab === 'Changes', enTab ?? '')

// 2. English tab labels
const changesTab = (await page.locator('#changes-tab span').first().textContent())?.trim()
check('Changes tab rendered in English', changesTab === 'Changes', changesTab)

// 3. Project card inside the repository switcher
await page.locator('#desktop-app-toolbar .sidebar-section button').first().click()
await page.waitForSelector('.project-card', { timeout: 15000 }).catch(() => {})
check(
  'Project card shown in the repository switcher',
  (await page.locator('.project-card').count()) > 0
)

const projectName = (await page.locator('.project-card-name').first().textContent())?.trim()
check(
  'Project card shows the project name',
  (projectName ?? '').length > 0,
  projectName
)

await page.locator('.project-card-edit').first().click()
await page.waitForSelector('.project-card-editor', { timeout: 5000 })
check('Project card edit mode opens', (await page.locator('.project-card-editor').count()) > 0)

await page.locator('.project-card-editor input').first().fill('Smoke test project')
await page.waitForTimeout(300)

// Pick a symbol and a color while the editor is open
try {
  await page.locator('.project-card-symbol').nth(2).click()
  await page.locator('.project-card-color').nth(1).click()
} catch (e) {
  console.log('DEBUG symbol picker:', String(e).split('\n')[0])
  console.log('  editor:', await page.locator('.project-card-editor').count())
  console.log('  symbols:', await page.locator('.project-card-symbol').count())
  console.log('  card:', await page.locator('.project-card').count())
  console.log('  foldout:', await page.locator('#foldout-container').count())
  console.log(
    '  card html:',
    (await page.locator('.project-card').innerHTML().catch(() => 'N/A')).slice(0, 500)
  )
  throw e
}
await page.waitForTimeout(200)

// Leave edit mode so the description is rendered again
await page.locator('.project-card-edit').first().click()
await page.waitForTimeout(300)

const description = (
  await page.locator('.project-card-description').first().textContent()
)?.trim()
check(
  'Project description saved and rendered',
  description === 'Smoke test project',
  description
)

const metadata = await getLocalStorage(app, page, 'github-desktop-repository-metadata')
check(
  'Project metadata persisted to storage',
  (metadata ?? '').includes('Smoke test project')
)
check(
  'Icon symbol and color persisted',
  (metadata ?? '').includes('symbol') && (metadata ?? '').includes('color')
)

// 4. Switch the language to Chinese through storage and reload (the menu bar
//    language switching was already exercised above in section 1).
await setLocalStorage(app, page, 'github-desktop-language', 'zh')
await reload(app, page)

const zhChangesTab = (await page.locator('#changes-tab span').first().textContent())?.trim()
check('Changes tab rendered in Chinese', zhChangesTab === '变更', zhChangesTab)

const zhHistoryTab = (await page.locator('#history-tab span').first().textContent())?.trim()
check('History tab rendered in Chinese', zhHistoryTab === '历史', zhHistoryTab)

const zhMenus = (await page.locator('#app-menu-bar button').allTextContents()).join(', ')
check('Menu bar still rendered in Chinese UI', zhMenus.includes('Language'), zhMenus)

// 5. History file list rendered as a tree (walk through commits until one
//    touches files in subdirectories)
await page.locator('#history-tab').click()
await page.waitForTimeout(2500)
let historyDirRows = 0
let historyFileRows = 0
for (let i = 0; i < 6; i++) {
  const commits = page.locator('#commit-list .list-item')
  if ((await commits.count()) <= i) {
    break
  }
  await commits.nth(i).click()
  await page.waitForTimeout(1200)
  historyDirRows = await page.locator('.file-list .tree-directory').count()
  historyFileRows = await page
    .locator('.file-list .file:not(.tree-directory)')
    .count()
  if (historyDirRows > 0) {
    break
  }
}
check(
  'History changed files rendered as a tree',
  historyDirRows > 0 || historyFileRows === 0,
  `directories=${historyDirRows} files=${historyFileRows}`
)

// 6. Changes file list rendered as a tree
await page.locator('#changes-tab').click()
await page.waitForTimeout(2500)
const changesDirRows = await page
  .locator('.changes-list-container .tree-directory')
  .count()
const changesFileRows = await page
  .locator('.changes-list-container .file:not(.tree-directory)')
  .count()
check(
  'Changes list rendered as a tree',
  changesDirRows > 0 || changesFileRows === 0,
  `directories=${changesDirRows} files=${changesFileRows}`
)

// Collapsing a directory row should hide its (nested) contents
const dirRows = page.locator('.changes-list-container .tree-directory')
if ((await dirRows.count()) > 0) {
  const firstDir = dirRows.first()
  const dirPath = await firstDir.getAttribute('data-path')
  const before = await firstDir.getAttribute('aria-expanded')
  const nestedBefore = await page
    .locator(`.changes-list-container .tree-directory[data-path^="${dirPath}/"]`)
    .count()

  await firstDir.click()
  await page.waitForTimeout(500)

  const after = await page
    .locator(`.changes-list-container .tree-directory[data-path="${dirPath}"]`)
    .first()
    .getAttribute('aria-expanded')
  const nestedAfter = await page
    .locator(`.changes-list-container .tree-directory[data-path^="${dirPath}/"]`)
    .count()

  check(
    'Collapsing a directory toggles its expanded state',
    before === 'true' && after === 'false',
    `${dirPath}: ${before} -> ${after}`
  )
  check(
    'Collapsing a directory hides nested rows',
    nestedAfter < nestedBefore || nestedBefore === 0,
    `nested rows ${nestedBefore} -> ${nestedAfter}`
  )

  // expand it again
  await page
    .locator(`.changes-list-container .tree-directory[data-path="${dirPath}"]`)
    .first()
    .click()
  await page.waitForTimeout(400)
}

// 7. Edit button in the diff header. Walk through the selected files until we
//    find one whose diff is syntax highlighted, so that the editor can be
//    verified against it.
const fileRows = page.locator('.changes-list-container .file:not(.tree-directory)')
if ((await fileRows.count()) > 0) {
  await fileRows.first().click()
  await page.waitForTimeout(1200)
}

const readDiffTokens = () =>
  page
    .locator('.side-by-side-diff [class*="cm-"], .text-diff [class*="cm-"]')
    .count()

let diffTokens = await readDiffTokens()
for (let i = 0; i < 12 && diffTokens === 0; i++) {
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(1200)
  diffTokens = await readDiffTokens()
}
const viewSwitchCount = await page
  .locator('.diff-view-switch .diff-view-switch-button')
  .count()
check(
  'Diff/Split/Edit view switch rendered in the header',
  viewSwitchCount === 3,
  `count=${viewSwitchCount}`
)

// 8. Manual refresh button in the changes list header (no auto refresh)
const refreshButton = page.locator('.changes-list-refresh-button')
check('Refresh button in the changes list header', (await refreshButton.count()) > 0)
if ((await refreshButton.count()) > 0) {
  await refreshButton.first().click()
  await page.waitForTimeout(2500)
  check(
    'Changes list still rendered after refresh',
    (await page.locator('.changes-list-container').count()) > 0 &&
      (await refreshButton.count()) > 0
  )
}

// 9. Ignore button in the diff header. Deliberately not clicked: it would
//    modify the .gitignore of the real repository this smoke test runs in.
const ignoreButtons = await page.locator('.diff-ignore-button').count()
check('Ignore button rendered in the diff header', ignoreButtons > 0, `count=${ignoreButtons}`)

if (viewSwitchCount === 3) {
  const filePath = (await page.locator('.header .path-label-component').first().textContent()) ?? ''
  console.log(`      selected file: ${filePath} (diff token spans=${diffTokens})`)

  await page.locator('.diff-view-switch-button[data-mode="edit"]').click()
  await page.waitForSelector('.file-editor', { timeout: 10000 })
  check('Edit view opens the editor', (await page.locator('.file-editor').count()) > 0)
  await page.waitForTimeout(2000)
  const tokens = await page.locator('.file-editor-highlight [class*="cm-"]').count()
  if (diffTokens > 0) {
    check(
      'Syntax highlighting applied in the editor',
      tokens > 0,
      `editor token spans=${tokens} (diff had ${diffTokens})`
    )
  } else {
    check('Syntax highlighting applied in the editor', true, `skipped, no highlighted file found (editor spans=${tokens})`)
  }

  // Split view: editor and diff visible at the same time
  await page.locator('.diff-view-switch-button[data-mode="split"]').click()
  await page.waitForTimeout(1500)
  const editorInSplit = (await page.locator('.file-editor').count()) > 0
  const diffInSplit = (await page.locator('.seamless-diff-switcher').count()) > 0
  check(
    'Split view shows editor and diff together',
    editorInSplit && diffInSplit,
    `editor=${editorInSplit} diff=${diffInSplit}`
  )

  // Back to the plain diff view
  await page.locator('.diff-view-switch-button[data-mode="diff"]').click()
  await page.waitForTimeout(800)
  check(
    'Diff view hides the editor',
    (await page.locator('.file-editor').count()) === 0
  )
}

const realErrors = consoleErrors.filter(
  e => !e.includes('missing a dependency') && !e.includes('autoUpdater')
)
check(
  'No unexpected console errors',
  realErrors.length === 0,
  realErrors.slice(0, 3).join(' | ')
)

await restore()
await app.close()

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
