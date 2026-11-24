/** Optional full-Agent execution integration; never an LLM adapter registration. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ModelCatalogFailure, ModelProviderGroup, SessionPromptRequest, SessionSelectModelRequest, SessionSelectModelValue } from './types.ts'

/** Full-Agent runtimes contributing catalog entries and confirmed selections. */
export interface ExternalAgents {
  /** Read advertised models and actionable engine failures without generating. */
  catalog(): Promise<{ groups: readonly ModelProviderGroup[]; failures: readonly ModelCatalogFailure[] }>
  /** Whether the runtime owns this selection or the existing Agent. */
  handlesSelection(agent: Agent, request: SessionSelectModelRequest): boolean
  /** Confirm the actual engine choice; cross-engine changes return a new Session. */
  selectModel(agent: Agent, request: SessionSelectModelRequest): Promise<SessionSelectModelValue>
  /** Validate content and steering against the bound external Agent's capabilities. */
  validatePrompt(agent: Agent, request: SessionPromptRequest): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional full-Agent runtime contribution owned by an installed plugin. */
    externalAgents: ExternalAgents
  }
}
