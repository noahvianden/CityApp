import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const pathsToClean = [
  'dist',
  'android/app/src/main/assets/public',
]

for (const relativePath of pathsToClean) {
  const absolutePath = resolve(process.cwd(), relativePath)
  rmSync(absolutePath, { recursive: true, force: true })
  console.info(`[cityapp-build] cleaned ${relativePath}`)
}
