import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  findSensitiveRuleForPath,
  findSensitiveFiles,
  isSensitiveScanOptedOut,
  setSensitiveScanOptedOut,
} from '../../src/lib/sensitive-files'

const reasonFor = (path: string) => findSensitiveRuleForPath(path)?.reason

describe('findSensitiveRuleForPath', () => {
  it('flags environment files', () => {
    assert.strictEqual(reasonFor('.env'), 'env')
    assert.strictEqual(reasonFor('config/.env.local'), 'env')
    assert.strictEqual(reasonFor('.env.production'), 'env')
    assert.strictEqual(reasonFor('deploy/prod.env'), 'env')
  })

  it('does not flag environment templates', () => {
    assert.strictEqual(findSensitiveRuleForPath('.env.example'), null)
    assert.strictEqual(findSensitiveRuleForPath('.env.sample'), null)
    assert.strictEqual(
      findSensitiveRuleForPath('.env.production.example'),
      null
    )
  })

  it('flags private keys and certificates', () => {
    assert.strictEqual(reasonFor('server.key'), 'key')
    assert.strictEqual(reasonFor('certs/tls.pem'), 'key')
    assert.strictEqual(reasonFor('id_rsa'), 'key')
    assert.strictEqual(reasonFor('.ssh/id_ed25519'), 'key')
    assert.strictEqual(reasonFor('keystore.jks'), 'key')
    assert.strictEqual(reasonFor('backup.ppk'), 'key')
    assert.strictEqual(reasonFor('client.p12'), 'key')
    assert.strictEqual(reasonFor('private_key.json'), 'key')
  })

  it('flags credential files', () => {
    assert.strictEqual(reasonFor('.npmrc'), 'credential')
    assert.strictEqual(reasonFor('.netrc'), 'credential')
    assert.strictEqual(reasonFor('credentials.json'), 'credential')
    assert.strictEqual(reasonFor('my-secrets.json'), 'credential')
    assert.strictEqual(reasonFor('secrets.yaml'), 'credential')
    assert.strictEqual(reasonFor('google-services.json'), 'credential')
    assert.strictEqual(reasonFor('service-account-staging.json'), 'credential')
    assert.strictEqual(reasonFor('vault.kdbx'), 'credential')
  })

  it('flags sensitive directories', () => {
    assert.strictEqual(reasonFor('secrets/token.txt'), 'folder')
    assert.strictEqual(reasonFor('.aws/credentials'), 'credential')
    assert.strictEqual(reasonFor('.aws/secret-access-key'), 'folder')
    assert.strictEqual(reasonFor('.gnupg/random-file'), 'folder')
    assert.strictEqual(reasonFor('private/key-material.txt'), 'folder')
  })

  it('flags dependency directories', () => {
    assert.strictEqual(reasonFor('node_modules/left-pad/index.js'), 'deps')
  })

  it('normalizes windows separators', () => {
    assert.strictEqual(reasonFor('secrets\\token.txt'), 'folder')
  })

  it('matches case-insensitively', () => {
    assert.strictEqual(reasonFor('ID_RSA'), 'key')
    assert.strictEqual(reasonFor('Credentials.JSON'), 'credential')
    assert.strictEqual(reasonFor('NODE_MODULES/pkg/index.js'), 'deps')
  })

  it('ignores ordinary source files', () => {
    assert.strictEqual(findSensitiveRuleForPath('src/index.ts'), null)
    assert.strictEqual(findSensitiveRuleForPath('README.md'), null)
    assert.strictEqual(findSensitiveRuleForPath('package.json'), null)
    assert.strictEqual(findSensitiveRuleForPath('public/keyvisual.png'), null)
    assert.strictEqual(findSensitiveRuleForPath('webpack.config.js'), null)
  })
})

describe('findSensitiveFiles', () => {
  it('returns every matching file in the pending commit', () => {
    const matches = findSensitiveFiles([
      'src/app.ts',
      '.env.production',
      'docs/readme.md',
      'secrets/token.txt',
      'node_modules/dep/index.js',
    ])

    assert.deepStrictEqual(
      matches.map(m => m.path),
      ['.env.production', 'secrets/token.txt', 'node_modules/dep/index.js']
    )
    assert.deepStrictEqual(
      matches.map(m => m.reason),
      ['env', 'folder', 'deps']
    )
  })

  it('returns an empty list for a clean commit', () => {
    assert.deepStrictEqual(
      findSensitiveFiles(['src/a.ts', 'src/b.css', 'package.json']),
      []
    )
  })
})

describe('sensitive scan opt-out', () => {
  it('is per repository', () => {
    assert.strictEqual(isSensitiveScanOptedOut(991919191), false)
    setSensitiveScanOptedOut(991919191)
    assert.strictEqual(isSensitiveScanOptedOut(991919191), true)
    assert.strictEqual(isSensitiveScanOptedOut(123456789), false)
  })
})
