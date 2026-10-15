export function assertModeratorConfigUpdate(persisted, incoming) {
  const currentDashboards = new Map(persisted.dashboards.map((item) => [item.id, item]))
  if (incoming.dashboards.length !== currentDashboards.size
    || incoming.dashboards.some((item) => !currentDashboards.has(item.id))) {
    throw new Error('Moderadores não podem criar nem excluir painéis.')
  }
  if (incoming.defaultDashboardId !== persisted.defaultDashboardId
    || JSON.stringify(incoming.preferences) !== JSON.stringify(persisted.preferences)
    || JSON.stringify(incoming.alertRules) !== JSON.stringify(persisted.alertRules)) {
    throw new Error('Moderadores não podem alterar as configurações globais.')
  }
  for (const next of incoming.dashboards) {
    const current = currentDashboards.get(next.id)
    if (next.title !== current.title || next.type !== current.type || next.favorite !== current.favorite) {
      throw new Error('Moderadores não podem renomear nem excluir painéis.')
    }
    const currentSections = new Map(current.sections.map((section) => [section.id, section]))
    if (next.sections.length < currentSections.size
      || current.sections.some((section) => (
        JSON.stringify(next.sections.find((item) => item.id === section.id)) !== JSON.stringify(section)
      ))) {
      throw new Error('Moderadores podem adicionar seções, mas não editar nem excluir as existentes.')
    }
    const currentWidgets = new Map(current.widgets.map((widget) => [widget.id, widget]))
    if (next.widgets.length < currentWidgets.size
      || current.widgets.some((widget) => (
        JSON.stringify(next.widgets.find((item) => item.id === widget.id)) !== JSON.stringify(widget)
      ))) {
      throw new Error('Moderadores podem adicionar indicadores, mas não editar nem excluir os existentes.')
    }
    for (const key of ['hiddenIcmp', 'hiddenServers']) {
      if (JSON.stringify(next[key]) !== JSON.stringify(current[key])) {
        throw new Error('Moderadores não podem remover cards.')
      }
    }
    for (const key of ['orderIcmp', 'orderServers']) {
      if (current[key].some((name) => !next[key].includes(name))) {
        throw new Error('Moderadores podem mover cards, mas não removê-los.')
      }
    }
    if (Object.keys(current.assignments).some((name) => !(name in next.assignments))) {
      throw new Error('Moderadores podem mover cards, mas não removê-los.')
    }
  }
}
