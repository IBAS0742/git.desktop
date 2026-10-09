import { getObject, setObject } from './local-storage'

/** Why a file was flagged as potentially sensitive, drives the dialog copy */
export type SensitiveReason = 'env' | 'key' | 'credential' | 'folder' | 'deps'

/** A file in the pending commit which matched one of the default rules */
export interface ISensitiveFileMatch {
  /** Repository-relative path using '/' as the separator */
  readonly path: string
  readonly reason: SensitiveReason
}

/**
 * Default recommended rules: file types and folders which commonly contain
 * secrets or environment-specific configuration and are worth a second look
 * before they end up in a commit.
 */

/** File extensions (lowercase) which usually hold keys or credentials */
const SensitiveExtensions: Readonly<Record<string, SensitiveReason>> = {
  '.env': 'env',
  '.pem': 'key',
  '.key': 'key',
  '.p12': 'key',
  '.pfx': 'key',
  '.jks': 'key',
  '.keystore': 'key',
  '.kdbx': 'credential',
  '.ppk': 'key',
  '.ovpn': 'credential',
}

/** Exact file names (lowercase) which are almost always credentials */
const SensitiveBaseNames: Readonly<Record<string, SensitiveReason>> = {
  '.npmrc': 'credential',
  '.pypirc': 'credential',
  '.netrc': 'credential',
  '.htpasswd': 'credential',
  credentials: 'credential',
  'credentials.json': 'credential',
  'secrets.json': 'credential',
  'service-account.json': 'credential',
  'serviceaccount.json': 'credential',
  'keyfile.json': 'credential',
  'google-services.json': 'credential',
}

/** Additional name patterns for generated or suffixed secret files */
const SensitiveNamePatterns: ReadonlyArray<{
  readonly regex: RegExp
  readonly reason: SensitiveReason
}> = [
  { regex: /^\.env(\..+)?$/i, reason: 'env' },
  { regex: /^id_(rsa|dsa|ecdsa|ed25519)(\..+)?$/i, reason: 'key' },
  { regex: /^private[-_.]?key(\..+)?$/i, reason: 'key' },
  { regex: /^service[-_]?account.*\.json$/i, reason: 'credential' },
  {
    regex: /(^|[-_.])secrets?\.(json|ya?ml|toml|ini|txt)$/i,
    reason: 'credential',
  },
]

/** Names which look sensitive but are safe to commit (templates/examples) */
const SafeNamePatterns: ReadonlyArray<RegExp> = [
  /^\.env(\.[\w-]+)*\.(example|sample|template|dist)$/i,
  /^secrets?\.(example|sample)\.(json|ya?ml)$/i,
]

/** Directory names which should be reviewed before committing */
const SensitiveDirectories: Readonly<Record<string, SensitiveReason>> = {
  '.ssh': 'folder',
  '.aws': 'folder',
  '.gnupg': 'folder',
  secrets: 'folder',
  credentials: 'folder',
  private: 'folder',
  node_modules: 'deps',
}

/**
 * Returns the first rule matching the given repository-relative path or null
 * when the path doesn't look sensitive. Git uses '/' in paths regardless of
 * platform, but we normalize defensively.
 */
export function findSensitiveRuleForPath(
  path: string
): ISensitiveFileMatch | null {
  const normalized = path.replace(/\\/g, '/')
  const segments = normalized.split('/')
  const baseName = segments[segments.length - 1] ?? normalized
  const lowerBaseName = baseName.toLowerCase()

  if (SafeNamePatterns.some(pattern => pattern.test(baseName))) {
    return null
  }

  const nameRule = SensitiveNamePatterns.find(({ regex }) =>
    regex.test(baseName)
  )
  if (nameRule !== undefined) {
    return { path: normalized, reason: nameRule.reason }
  }

  const dotIndex = baseName.lastIndexOf('.')
  const extension = dotIndex > 0 ? baseName.slice(dotIndex).toLowerCase() : ''

  if (extension in SensitiveExtensions) {
    return { path: normalized, reason: SensitiveExtensions[extension] }
  }

  if (lowerBaseName in SensitiveBaseNames) {
    return { path: normalized, reason: SensitiveBaseNames[lowerBaseName] }
  }

  for (const segment of segments.slice(0, -1)) {
    const lowerSegment = segment.toLowerCase()
    if (lowerSegment in SensitiveDirectories) {
      return { path: normalized, reason: SensitiveDirectories[lowerSegment] }
    }
  }

  return null
}

/**
 * Scans the paths about to be committed against the default recommended
 * rules and returns every match. Empty when the commit looks clean.
 */
export function findSensitiveFiles(
  paths: ReadonlyArray<string>
): ReadonlyArray<ISensitiveFileMatch> {
  const matches = new Array<ISensitiveFileMatch>()

  for (const path of paths) {
    const match = findSensitiveRuleForPath(path)
    if (match !== null) {
      matches.push(match)
    }
  }

  return matches
}

const OptOutStorageKey = 'github-desktop-sensitive-scan-optout'

type OptOutLookup = { [repositoryId: number]: true }

let optOuts: OptOutLookup | null = null

function loadOptOuts(): OptOutLookup {
  if (optOuts === null) {
    optOuts = getObject<OptOutLookup>(OptOutStorageKey) ?? {}
  }

  return optOuts
}

/** Whether the user chose to no longer be warned in the given repository */
export function isSensitiveScanOptedOut(repositoryId: number): boolean {
  return loadOptOuts()[repositoryId] === true
}

/** Persist the user's choice to not be warned again in the given repository */
export function setSensitiveScanOptedOut(repositoryId: number) {
  const all = { ...loadOptOuts() }
  all[repositoryId] = true
  optOuts = all
  setObject(OptOutStorageKey, all)
}
