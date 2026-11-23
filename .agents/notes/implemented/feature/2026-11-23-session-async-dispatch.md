# Agent Note: Session async-dispatch preference

Status: implemented

English | [中文](2026-11-23-session-async-dispatch.zh.md)

## Problem

A general instruction to move complex tasks to the task board can override a user's wish to keep work in the current conversation. A toolbar switch needs to change the model's actual orchestration guidance while leaving ongoing work and permissions alone.

## Decision

Conversation owns a default-off session projection with separate selected and admitted values. Its existing human-command route persists selections without invoking the model. Ordinary composer submissions capture the selected value; historical and non-Web inputs without a captured field mean off. At an accepted pre-step, the last admitted human input controls the required runtime context until another human input is admitted. Retries retain that policy.

A selection in flight and its confirmed target belong to the shared Conversation controller. Submissions wait for the write and use the confirmed value while its projection catches up. This prevents opposite-mode sends when command receipts and projection frames arrive separately. Session identities scope both the persistent projection and the pending operation.

## Alternatives considered

**Presentation-only state.** A switch backed only by browser state cannot override existing orchestration guidance and loses its meaning across entry points and recovery.

**Read the latest selection during every model step.** This changes an active task after a click and applies a later preference to previously queued messages. Admission instead uses each message's captured choice.

**A new scheduler or tool-permission gate.** The feature expresses a preference and must allow explicit current-user task-board instructions. Existing task-board tools still own execution, and permission owners still authorize operations.

## Consequences

Off guidance explicitly overrides complexity-based automatic board routing. On guidance prefers suitable task execution on the board while keeping ordinary questions direct. Explicit current-user dispatch instructions override either preference. New sessions start off; session reload restores the selected value. The implementation adds a small required runtime-context section and two log-only event types, without restarting or redispatching existing work. The persisted schema acknowledgement documents old-input defaults and old-reader refusal of unfamiliar event discriminators.
