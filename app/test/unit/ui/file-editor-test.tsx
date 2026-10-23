import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as Path from 'path'

import { fireEvent, render, waitFor } from '../../helpers/ui/render'
import { FileEditor } from '../../../src/ui/diff/file-editor'
import { Repository } from '../../../src/models/repository'

describe('FileEditor', () => {
  let directory: string
  let repository: Repository

  beforeEach(async () => {
    directory = await fs.mkdtemp(Path.join(os.tmpdir(), 'file-editor-test-'))
    repository = new Repository(directory, 1, null, false)

    await fs.mkdir(Path.join(directory, 'src'), { recursive: true })
    await fs.writeFile(
      Path.join(directory, 'src', 'example.ts'),
      'const x = 1\n',
      'utf8'
    )
  })

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('loads the file contents from disk', async () => {
    const { container } = render(
      <FileEditor
        repository={repository}
        filePath={'src/example.ts'}
        onClose={() => undefined}
        onSaved={() => undefined}
      />
    )

    const textarea = container.querySelector('textarea')
    assert.notStrictEqual(textarea, null)

    await waitFor(() =>
      assert.strictEqual(
        (textarea as HTMLTextAreaElement).value,
        'const x = 1\n'
      )
    )
  })

  it('writes the edited contents back to disk when saved', async () => {
    let saved = 0
    const { container } = render(
      <FileEditor
        repository={repository}
        filePath={'src/example.ts'}
        onClose={() => undefined}
        onSaved={() => {
          saved++
        }}
      />
    )

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await waitFor(() => assert.strictEqual(textarea.value, 'const x = 1\n'))

    fireEvent.change(textarea, { target: { value: 'const x = 2\n' } })

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent === 'Save'
    )
    assert.notStrictEqual(saveButton, undefined)

    fireEvent.click(saveButton!)

    await waitFor(async () => {
      const contents = await fs.readFile(
        Path.join(directory, 'src', 'example.ts'),
        'utf8'
      )
      assert.strictEqual(contents, 'const x = 2\n')
      assert.strictEqual(saved, 1)
    })
  })

  it('reports read failures instead of rendering an empty editor', async () => {
    const { container } = render(
      <FileEditor
        repository={repository}
        filePath={'does/not/exist.ts'}
        onClose={() => undefined}
        onSaved={() => undefined}
      />
    )

    await waitFor(() => {
      const error = container.querySelector('.file-editor-error')
      assert.notStrictEqual(error, null)
    })
  })
})
