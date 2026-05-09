import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import MobileDiagnosticsPanel from './MobileDiagnosticsPanel.tsx'
import { bootstrapNativeSnapshotIntoLocalStorage, startNativeSnapshotMirror } from './mobileSnapshotStore.ts'
import './mobileVisualPolish.css'
import './visualSpriteSystem.css'

async function startApp() {
  await bootstrapNativeSnapshotIntoLocalStorage()
  startNativeSnapshotMirror()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
      <MobileDiagnosticsPanel />
    </StrictMode>,
  )
}

void startApp()
