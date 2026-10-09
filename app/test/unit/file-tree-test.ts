import assert from 'node:assert'
import { describe, it } from 'node:test'

import { buildFileTreeRows, getPathSegments } from '../../src/ui/lib/file-tree'

interface ITestFile {
  readonly path: string
}

const file = (path: string): ITestFile => ({ path })

const getPaths = (files: ReadonlyArray<ITestFile>) =>
  buildFileTreeRows(files, new Set<string>(), f => f.path).map(
    r =>
      `${'  '.repeat(r.depth)}${r.kind === 'directory' ? '[d] ' : ''}${r.path}`
  )

const getPath = (f: ITestFile) => f.path

describe('getPathSegments', () => {
  it('splits forward slash paths', () => {
    assert.deepStrictEqual(getPathSegments('src/lib/foo.ts'), [
      'src',
      'lib',
      'foo.ts',
    ])
  })

  it('splits mixed separator paths', () => {
    assert.deepStrictEqual(getPathSegments('src\\lib/foo.ts'), [
      'src',
      'lib',
      'foo.ts',
    ])
  })

  it('returns a single segment for root level files', () => {
    assert.deepStrictEqual(getPathSegments('README.md'), ['README.md'])
  })

  it('ignores empty segments', () => {
    assert.deepStrictEqual(getPathSegments('src//foo.ts'), ['src', 'foo.ts'])
  })
})

describe('buildFileTreeRows', () => {
  it('returns an empty array for no files', () => {
    assert.deepStrictEqual(buildFileTreeRows([], new Set(), getPath), [])
  })

  it('groups files by directory', () => {
    const rows = getPaths([
      file('src/lib/foo.ts'),
      file('src/lib/bar.ts'),
      file('README.md'),
    ])

    assert.deepStrictEqual(rows, [
      '[d] src',
      '  [d] src/lib',
      '    src/lib/bar.ts',
      '    src/lib/foo.ts',
      'README.md',
    ])
  })

  it('sorts directories before files and alphabetically', () => {
    const rows = getPaths([
      file('b.txt'),
      file('z/a.ts'),
      file('a/nested/x.ts'),
      file('a/file.txt'),
    ])

    assert.deepStrictEqual(rows, [
      '[d] a',
      '  [d] a/nested',
      '    a/nested/x.ts',
      '  a/file.txt',
      '[d] z',
      '  z/a.ts',
      'b.txt',
    ])
  })

  it('omits rows of collapsed directories', () => {
    const rows = buildFileTreeRows(
      [file('src/lib/foo.ts'), file('src/bar.ts')],
      new Set(['src/lib']),
      getPath
    ).map(r => `${'  '.repeat(r.depth)}${r.path}`)

    assert.deepStrictEqual(rows, ['src', '  src/lib', '  src/bar.ts'])
  })

  it('assigns a stable depth to every row', () => {
    const rows = buildFileTreeRows(
      [file('a/b/c/d.ts'), file('a/b.ts'), file('top.ts')],
      new Set(),
      getPath
    )

    const byPath = new Map(rows.map(r => [r.path, r.depth]))

    assert.strictEqual(byPath.get('a'), 0)
    assert.strictEqual(byPath.get('a/b'), 1)
    assert.strictEqual(byPath.get('a/b/c/d.ts'), 3)
    assert.strictEqual(byPath.get('a/b.ts'), 1)
    assert.strictEqual(byPath.get('top.ts'), 0)
  })

  it('keeps references to the original file objects', () => {
    const original = file('src/foo.ts')
    const rows = buildFileTreeRows([original], new Set(), getPath)

    assert.strictEqual(rows.find(r => r.kind === 'file')?.file, original)
    assert.strictEqual(rows.find(r => r.kind === 'directory')?.file, null)
  })
})
