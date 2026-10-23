// One-off cleanup: clears the project-card metadata that verify-ui.mjs wrote
// during smoke testing (it did not exist before this session).
import path from 'node:path'
import { _electron as electron } from 'playwright'

const exe = path.resolve('dist/GitHubDesktop-win32-x64/GitHubDesktop.exe')
const app = await electron.launch({ executablePath: exe, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('#desktop-app-contents', { timeout: 60000 })
await page.waitForTimeout(2000)

const before = await page.evaluate(() =>
  window.localStorage.getItem('github-desktop-repository-metadata')
)

await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]
  return win.webContents.executeJavaScript(
    `window.localStorage.removeItem('github-desktop-repository-metadata')`
  )
})

const after = await page.evaluate(() =>
  window.localStorage.getItem('github-desktop-repository-metadata')
)
const language = await page.evaluate(() =>
  window.localStorage.getItem('github-desktop-language')
)

console.log(`metadata before: ${before === null ? 'none' : 'set'}`)
console.log(`metadata after:  ${after === null ? 'none' : 'set'}`)
console.log(`language:        ${language}`)

await app.close()
process.exit(after === null && language === 'zh' ? 0 : 1)
