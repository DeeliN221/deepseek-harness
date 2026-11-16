# Changelog

## Unreleased

### `@deepseek-ai/dsh-client-ui-chat`

- Fold intermediate commentary, assistant replies, and tool progress by default for completed OpenAI-format provider Turns once `turn-process` establishes a reliable `answerAnchorSeq` / `answerStep` final answer, while keeping the final answer expanded and allowing manual expansion via `TurnProcessNodeView`.
- Keep OpenAI-format Turns expanded during streaming, on failure/interruption (`error`, `aborted`, `interrupted`), and when no reliable final answer boundary (`answerAnchorSeq === null`) exists.
- Preserve existing DeepSeek reasoning and `foldedReplies` defaults without regression by excluding DeepSeek routes and models from OpenAI-format auto-folding.
