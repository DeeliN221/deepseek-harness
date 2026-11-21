/** One active search provider, owned by the Workspace UI service lifetime. */
export function createWorkspaceSearchHandler(): {
  register: (handler: () => boolean) => () => void
  dispatch: () => boolean
} {
  const handlers = new Map<symbol, () => boolean>()
  return {
    register(handler) {
      const key = Symbol('workspace-search')
      handlers.set(key, handler)
      return () => { handlers.delete(key) }
    },
    dispatch() {
      const handler = [...handlers.values()].at(-1)
      if (!handler) return false
      try { return handler() === true } catch (error) {
        console.warn('Workspace search provider failed; using native search', error)
        return false
      }
    },
  }
}
