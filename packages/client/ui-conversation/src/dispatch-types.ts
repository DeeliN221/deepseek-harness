/** Browser-safe session projection vocabulary for async dispatch. */
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Selection captured by the next user submission; absent historical values mean off. */
    asyncDispatch: boolean
  }
}
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Choice persisted for the next submission, without changing an active turn. */
    'conversation/async-dispatch-selected': { enabled: boolean }
    /** Captured policy committed only when a human input is admitted. */
    'conversation/async-dispatch-admitted': { enabled: boolean }
  }
}
export {}
