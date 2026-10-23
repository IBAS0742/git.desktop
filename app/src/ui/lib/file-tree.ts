/**
 * A single row in a flattened file tree.
 *
 * Directory rows are rendered as collapsible tree nodes whereas file rows
 * represent an actual (changed) file.
 */
export interface IFileTreeRow<T> {
  readonly kind: 'directory' | 'file'

  /** The depth of the row, zero being the root of the repository */
  readonly depth: number

  /** The repository relative path using '/' as a separator */
  readonly path: string

  /** The final segment of the path (file or directory name) */
  readonly name: string

  /** The file backing this row, null for directory rows */
  readonly file: T | null
}

interface IFileTreeDirectory<T> {
  readonly directories: Map<string, IFileTreeDirectory<T>>
  readonly files: Array<T>
}

const getSeparatorIndex = (path: string, fromIndex: number) => {
  const slash = path.indexOf('/', fromIndex)
  const backslash = path.indexOf('\\', fromIndex)
  if (slash === -1) {
    return backslash
  }
  if (backslash === -1) {
    return slash
  }
  return Math.min(slash, backslash)
}

/** Split a repository relative path into its individual segments */
export function getPathSegments(path: string): ReadonlyArray<string> {
  const segments = new Array<string>()
  let index = 0

  while (index <= path.length) {
    const separatorIndex = getSeparatorIndex(path, index)

    if (separatorIndex === -1) {
      if (index < path.length) {
        segments.push(path.slice(index))
      }
      break
    }

    if (separatorIndex > index) {
      segments.push(path.slice(index, separatorIndex))
    }

    index = separatorIndex + 1
  }

  return segments
}

/**
 * Builds the directory structure for the provided files.
 *
 * @param files   The files to place in the tree
 * @param getPath Returns the repository relative path for a given file
 */
function buildDirectory<T>(
  files: ReadonlyArray<T>,
  getPath: (file: T) => string
): IFileTreeDirectory<T> {
  const root: IFileTreeDirectory<T> = {
    directories: new Map<string, IFileTreeDirectory<T>>(),
    files: [],
  }

  for (const file of files) {
    const segments = getPathSegments(getPath(file))
    let directory = root

    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]
      let child = directory.directories.get(segment)

      if (child === undefined) {
        child = {
          directories: new Map<string, IFileTreeDirectory<T>>(),
          files: [],
        }
        directory.directories.set(segment, child)
      }

      directory = child
    }

    directory.files.push(file)
  }

  return root
}

/**
 * Flattens the given files into an array of rows which can be rendered as a
 * tree structure.
 *
 * Directories are sorted alphabetically and always come before the files
 * within the same directory. Files are sorted alphabetically as well so that
 * the resulting order is stable across refreshes.
 *
 * @param files                The files to build the tree from
 * @param collapsedDirectories Paths of directories which have been collapsed
 *                             by the user. Collapsed directories will not
 *                             yield any rows for their contents.
 * @param getPath              Returns the repository relative path for a file
 */
export function buildFileTreeRows<T>(
  files: ReadonlyArray<T>,
  collapsedDirectories: ReadonlySet<string>,
  getPath: (file: T) => string
): ReadonlyArray<IFileTreeRow<T>> {
  const root = buildDirectory(files, getPath)
  const rows = new Array<IFileTreeRow<T>>()

  const visit = (
    directory: IFileTreeDirectory<T>,
    directoryPath: string,
    depth: number
  ) => {
    const directoryNames = [...directory.directories.keys()].sort((a, b) =>
      a.localeCompare(b)
    )

    for (const name of directoryNames) {
      const path = directoryPath === '' ? name : `${directoryPath}/${name}`

      rows.push({
        kind: 'directory',
        depth,
        path,
        name,
        file: null,
      })

      if (!collapsedDirectories.has(path)) {
        visit(directory.directories.get(name)!, path, depth + 1)
      }
    }

    if (directory.files.length > 0) {
      const sortedFiles = [...directory.files].sort((a, b) =>
        getPath(a).localeCompare(getPath(b))
      )

      for (const file of sortedFiles) {
        const path = getPath(file)
        const segments = getPathSegments(path)
        rows.push({
          kind: 'file',
          depth,
          path,
          name: segments[segments.length - 1] ?? path,
          file,
        })
      }
    }
  }

  visit(root, '', 0)

  return rows
}

/**
 * A single row in the changes list file tree.
 *
 * Unlike `IFileTreeRow`, this also supports a special `ignored-directory` kind
 * for directories which are ignored as a whole and therefore have no known
 * children to expand.
 */
export interface IChangesFileTreeRow<T> {
  readonly kind: 'directory' | 'file' | 'ignored-directory'

  /** The depth of the row, zero being the root of the repository */
  readonly depth: number

  /** The repository relative path using '/' as a separator */
  readonly path: string

  /** The final segment of the path (file or directory name) */
  readonly name: string

  /** The file backing this row, null for directory rows */
  readonly file: T | null
}

interface IChangesFileTreeDirectory<T> {
  readonly directories: Map<string, IChangesFileTreeDirectory<T>>
  readonly files: Array<T>
  /** True when this directory is ignored as a whole via .gitignore */
  ignored: boolean
}

/**
 * Builds the directory structure for the provided files and ignored
 * directories, returning flattened rows suitable for rendering.
 *
 * Ignored directories are rendered as single, non-expandable rows since git
 * does not report the individual files contained within them.
 *
 * @param files              The files (changed and ignored) to place in the tree
 * @param ignoredDirectories Repository-relative paths of directories ignored as
 *                           a whole. Trailing slashes must already be stripped.
 * @param collapsedDirectories Paths of directories which have been collapsed
 *                             by the user.
 * @param getPath            Returns the repository relative path for a file
 */
export function buildChangesFileTreeRows<T>(
  files: ReadonlyArray<T>,
  ignoredDirectories: ReadonlyArray<string>,
  collapsedDirectories: ReadonlySet<string>,
  getPath: (file: T) => string
): ReadonlyArray<IChangesFileTreeRow<T>> {
  const root: IChangesFileTreeDirectory<T> = {
    directories: new Map<string, IChangesFileTreeDirectory<T>>(),
    files: [],
    ignored: false,
  }

  for (const file of files) {
    const segments = getPathSegments(getPath(file))
    let directory = root

    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]
      let child = directory.directories.get(segment)

      if (child === undefined) {
        child = {
          directories: new Map<string, IChangesFileTreeDirectory<T>>(),
          files: [],
          ignored: false,
        }
        directory.directories.set(segment, child)
      }

      directory = child
    }

    directory.files.push(file)
  }

  for (const ignoredDirectory of ignoredDirectories) {
    const segments = getPathSegments(ignoredDirectory)
    let directory = root

    for (const segment of segments) {
      let child = directory.directories.get(segment)

      if (child === undefined) {
        child = {
          directories: new Map<string, IChangesFileTreeDirectory<T>>(),
          files: [],
          ignored: false,
        }
        directory.directories.set(segment, child)
      }

      directory = child
    }

    directory.ignored = true
  }

  const rows = new Array<IChangesFileTreeRow<T>>()

  const visit = (
    directory: IChangesFileTreeDirectory<T>,
    directoryPath: string,
    depth: number
  ) => {
    const directoryNames = [...directory.directories.keys()].sort((a, b) =>
      a.localeCompare(b)
    )

    for (const name of directoryNames) {
      const child = directory.directories.get(name)!
      const path = directoryPath === '' ? name : `${directoryPath}/${name}`

      if (child.ignored) {
        rows.push({
          kind: 'ignored-directory',
          depth,
          path,
          name,
          file: null,
        })
        continue
      }

      rows.push({
        kind: 'directory',
        depth,
        path,
        name,
        file: null,
      })

      if (!collapsedDirectories.has(path)) {
        visit(child, path, depth + 1)
      }
    }

    if (directory.files.length > 0) {
      const sortedFiles = [...directory.files].sort((a, b) =>
        getPath(a).localeCompare(getPath(b))
      )

      for (const file of sortedFiles) {
        const path = getPath(file)
        const segments = getPathSegments(path)
        rows.push({
          kind: 'file',
          depth,
          path,
          name: segments[segments.length - 1] ?? path,
          file,
        })
      }
    }
  }

  visit(root, '', 0)

  return rows
}
