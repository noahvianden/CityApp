import type { AppTabItem } from '../appDomain'

type DummyPanelProps = {
  tab: AppTabItem
}

export function DummyPanel({ tab }: DummyPanelProps) {
  return (
    <section className="atlas-dummy-panel" aria-label={tab.label}>
      <span className="atlas-dummy-eyebrow">Placeholder</span>
      <h2>{tab.dummyTitle}</h2>
      <p>{tab.dummyBody}</p>
      <div className="atlas-dummy-card">
        <strong>{tab.icon}</strong>
        <span>Dummy content for the {tab.label} tab.</span>
      </div>
    </section>
  )
}
