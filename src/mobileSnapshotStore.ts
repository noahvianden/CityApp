import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { cityprintBackupStorageKey, cityprintStorageKey, readCityprintSnapshotFromRaw, type CityprintSnapshotWriteEventDetail } from './persistence'
import { isNativeRuntime } from './nativeRuntime'

const snapshotDirectory = 'Cityprint'
const primarySnapshotFile = 'snapshot-v1.json'
const backupSnapshotFile = 'snapshot-v1.backup.json'

let nativeMirrorStarted = false
let pendingWrite: Promise<void> = Promise.resolve()

async function readTextFile(path: string) {
  try {
    const result = await Filesystem.readFile({
      path: `${snapshotDirectory}/${path}`,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    })

    return typeof result.data === 'string' ? result.data : null
  } catch {
    return null
  }
}

async function writeTextFile(path: string, data: string) {
  await Filesystem.writeFile({
    path: `${snapshotDirectory}/${path}`,
    data,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  })
}

async function deleteTextFile(path: string) {
  try {
    await Filesystem.deleteFile({
      path: `${snapshotDirectory}/${path}`,
      directory: Directory.Data,
    })
  } catch {
    // The file may not exist yet; deletion is best-effort.
  }
}

async function writeNativeSnapshot(serializedSnapshot: string, backupEnabled: boolean) {
  await writeTextFile(primarySnapshotFile, serializedSnapshot)

  if (backupEnabled) {
    await writeTextFile(backupSnapshotFile, serializedSnapshot)
  } else {
    await deleteTextFile(backupSnapshotFile)
  }
}

export async function readNativeSerializedSnapshot() {
  if (!isNativeRuntime()) {
    return null
  }

  const primary = await readTextFile(primarySnapshotFile)

  if (readCityprintSnapshotFromRaw(primary)) {
    return primary
  }

  const backup = await readTextFile(backupSnapshotFile)

  return readCityprintSnapshotFromRaw(backup) ? backup : null
}

export async function bootstrapNativeSnapshotIntoLocalStorage(storage: Storage | undefined = globalThis.localStorage) {
  if (!storage || !isNativeRuntime()) {
    return 'skipped' as const
  }

  const nativeSnapshot = await readNativeSerializedSnapshot()

  if (!nativeSnapshot) {
    return 'empty' as const
  }

  storage.setItem(cityprintStorageKey, nativeSnapshot)

  const parsed = readCityprintSnapshotFromRaw(nativeSnapshot)

  if (parsed?.privacy.backupEnabled) {
    storage.setItem(cityprintBackupStorageKey, nativeSnapshot)
  } else {
    storage.removeItem(cityprintBackupStorageKey)
  }

  return 'restored' as const
}

export function startNativeSnapshotMirror() {
  if (nativeMirrorStarted || !isNativeRuntime() || typeof window === 'undefined') {
    return
  }

  nativeMirrorStarted = true

  window.addEventListener('cityprint:snapshot-written', (event) => {
    const detail = (event as CustomEvent<CityprintSnapshotWriteEventDetail>).detail

    if (!detail?.serializedSnapshot) {
      return
    }

    pendingWrite = pendingWrite
      .catch(() => undefined)
      .then(() => writeNativeSnapshot(detail.serializedSnapshot, detail.backupEnabled))
  })
}

export async function flushNativeSnapshotMirror() {
  await pendingWrite
}
