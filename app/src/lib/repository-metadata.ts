import { getObject, setObject } from './local-storage'

/**
 * User provided metadata for a repository, shown in the project switcher.
 * The description can be edited by the user and the icon is a combination of
 * a symbol and a background color.
 */
export interface IRepositoryMetadata {
  readonly description: string
  readonly symbol: string | null
  readonly color: string | null
}

const MetadataStorageKey = 'github-desktop-repository-metadata'

type MetadataLookup = { [repositoryId: number]: IRepositoryMetadata }

let metadata: MetadataLookup | null = null
const listeners = new Set<() => void>()

function loadMetadata(): MetadataLookup {
  if (metadata === null) {
    metadata = getObject<MetadataLookup>(MetadataStorageKey) ?? {}
  }

  return metadata
}

function notifyListeners() {
  for (const listener of listeners) {
    listener()
  }
}

/** Subscribe to changes of the repository metadata */
export function subscribeRepositoryMetadata(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** Get the metadata for a given repository, never null */
export function getRepositoryMetadata(
  repositoryId: number
): IRepositoryMetadata {
  return (
    loadMetadata()[repositoryId] ?? {
      description: '',
      symbol: null,
      color: null,
    }
  )
}

/** Persist the metadata for a given repository */
export function setRepositoryMetadata(
  repositoryId: number,
  value: IRepositoryMetadata
) {
  const all = { ...loadMetadata() }
  all[repositoryId] = value
  metadata = all
  setObject(MetadataStorageKey, all)
  notifyListeners()
}
