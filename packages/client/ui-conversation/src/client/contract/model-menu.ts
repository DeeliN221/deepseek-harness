/** Shared composer model-menu extension types; the model seat owns runtime declarations. */
/** Data identifying a keyed contribution displayed as a detail pane of the model menu. */
export interface ModelMenuPaneRef {
  /** Registration key in conversation.input.model.pane; also marks its root button's data-model-menu-pane. */
  key: string
  /** Localized accessible name of the detail pane. */
  title: string
}

/** Selection state and feedback shared by menu option entries and detail panes. */
export interface ModelMenuControls {
  /** Whether the composer refuses changes, including while a model selection is saving. */
  locked: boolean
  /** Close the menu and focus its trigger synchronously before opening another overlay. */
  dismiss: () => void
  /** Report a failed selection through the menu owner's persistent toast. */
  reportFailure: (message: string) => void
}

/** Root-menu controls for opening plugin-owned settings panes. */
export type ModelMenuOptions = ModelMenuControls & {
  /**
   * Open pane.key in conversation.input.model.pane with pane.title as its localized accessible name.
   * The root button's data-model-menu-pane must match pane.key for focus return.
   */
  openPane: (pane: ModelMenuPaneRef) => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Session options appended after model and reasoning controls in the root menu. */
    'conversation.input.model.options': {
      kind: 'list'
      scope: 'session'
      owner: ModelMenuOptions
    }
    /**
     * Plugin-owned content displayed as a model-menu detail pane.
     * The pane places its own initial focus, for example with `autoFocus`; without one,
     * focus stays on the menu surface, where Escape and Shift+Tab still return to the root menu.
     */
    'conversation.input.model.pane': {
      kind: 'keyed'
      scope: 'session'
      owner: ModelMenuControls
    }
  }
}
