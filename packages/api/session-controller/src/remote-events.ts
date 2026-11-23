/** Session Controller events available to a Remote Event assembly. */
type SessionControllerRemoteEvent =
  | 'api-session/activity'
  | 'api-session/added'
  | 'api-session/error'
  | 'api-session/removed'
  | 'api-session/status'
  | 'external-agents/catalog-updated'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Notify selectors after an external Agent reports updated configuration.
     * @mode emit
     */
    'external-agents/catalog-updated'(): void
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteEventSelection extends
    Record<SessionControllerRemoteEvent, true> {}
}

export {}
