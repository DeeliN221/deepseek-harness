/**
 * Animated two-tone navigation glyphs for the sidebar's global entries.
 *
 * Geometry: Kubai Icons `duotone` style (MIT, https://icons.kubai.design/,
 * package `kubai-icons-react@0.17.0`). The npm binding cannot be a client
 * dependency — its React runtime is not in the platform module table — so the
 * duotone geometry is vendored here and the paint is re-expressed as CSS
 * variables plus hover/focus-only animation. Every Kubai part keeps its
 * `data-l` index and gains a `data-layer` role (`main` / `soft` / `detail`)
 * that the stylesheet paints from one colour variable per navigation item.
 *
 * Motion contract: nothing animates at rest; an interactive ancestor's
 * `:hover` or `:focus-visible` starts it, and `prefers-reduced-motion: reduce`
 * removes it entirely while the two-tone paint stays.
 */
import { useId } from 'react'
import clsx from 'clsx'
import css from './nav-icons.module.css'

/** Nav glyph identity: one per animated sidebar entry (workspace is CSS-owned). */
export type NavGlyphName =
  | 'task-center'
  | 'task-board'
  | 'context-insight'
  | 'bot-team'
  | 'more'
  | 'new-session'
  | 'workspace'

/** Presentation props shared by every nav glyph. */
export interface NavGlyphProps {
  /** Square edge in pixels, as the sidebar asks its rows for. */
  size: number
  /** Panel identity stamped into the DOM for the panel icons only. */
  panelId?: string | undefined
}

/**
 * Common SVG envelope: decorative, Kubai duotone 16-unit grid, per-item ink.
 * @param props - glyph identity, size, optional panel identity, and the layers.
 * @returns one inline SVG glyph.
 */
function Glyph({ name, size, panelId, children }: NavGlyphProps & {
  name: NavGlyphName
  children: React.ReactNode
}) {
  return (
    <svg
      className={clsx(css.icon)}
      data-anim-icon={name}
      {...(panelId === undefined ? {} : { 'data-dsh-panel-entry': panelId })}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      overflow="visible"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/**
 * 任务中心: Kubai `clipboard-check` — clipboard whose check redraws and whose clip settles.
 * @param props - requested size and optional panel identity.
 * @returns the task-center glyph.
 */
export function TaskCenterGlyph({ size, panelId }: NavGlyphProps) {
  const maskId = 'dsh-nav-task-center-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <Glyph name="task-center" size={size} panelId={panelId}>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-2" y="-2" width="20" height="20">
          <rect x="-2" y="-2" width="20" height="20" fill="#fff" />
          <g data-l="1">
            <path d="M5 2.5C5 2.057 5 1.586 5.293 1.293C5.586 1 6.057 1 6.5 1L9.5 1C9.943 1 10.414 1 10.707 1.293C11 1.586 11 2.057 11 2.5L11 2.5C11 2.943 11 3.414 10.707 3.707C10.414 4 9.943 4 9.5 4L6.5 4C6.057 4 5.586 4 5.293 3.707C5 3.414 5 2.943 5 2.5Z" fill="#000" stroke="#000" strokeWidth="2" strokeLinejoin="round" />
          </g>
        </mask>
      </defs>
      <g data-l="all">
        <g mask={`url(#${maskId})`}>
          <g data-l="0" data-layer="soft">
            <path d="M2 6.1C2 4.614 2 3.672 2.586 3.086C3.172 2.5 4.114 2.5 5.6 2.5L10.4 2.5C11.886 2.5 12.828 2.5 13.414 3.086C14 3.672 14 4.614 14 6.1L14 11.4C14 12.886 14 13.828 13.414 14.414C12.828 15 11.886 15 10.4 15L5.6 15C4.114 15 3.172 15 2.586 14.414C2 13.828 2 12.886 2 11.4Z" />
          </g>
        </g>
        <g data-l="1" data-layer="main">
          <path d="M5 2.5C5 2.057 5 1.586 5.293 1.293C5.586 1 6.057 1 6.5 1L9.5 1C9.943 1 10.414 1 10.707 1.293C11 1.586 11 2.057 11 2.5L11 2.5C11 2.943 11 3.414 10.707 3.707C10.414 4 9.943 4 9.5 4L6.5 4C6.057 4 5.586 4 5.293 3.707C5 3.414 5 2.943 5 2.5Z" />
        </g>
        <g data-l="2" data-layer="detail">
          <path d="M5.75 9.5L7.25 11L10.25 8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
        </g>
      </g>
    </Glyph>
  )
}
/**
 * 上下文洞察: Kubai `lightbulb` — bulb that glows while its base settles.
 * @param props - requested size and optional panel identity.
 * @returns the context-insight glyph.
 */
export function ContextInsightGlyph({ size, panelId }: NavGlyphProps) {
  return (
    <Glyph name="context-insight" size={size} panelId={panelId}>

      <g data-l="all">
        <g data-l="0" data-layer="soft">
          <path d="M5.5 11V10.33A5 5 0 1 1 10.5 10.33V11Z" />
        </g>
        <g data-l="1" data-layer="main">
          <path d="M5.5 12L10.5 12L10.5 12.6C10.5 12.972 10.5 13.207 10.354 13.354C10.207 13.5 9.972 13.5 9.6 13.5L6.4 13.5C6.029 13.5 5.793 13.5 5.646 13.354C5.5 13.207 5.5 12.972 5.5 12.6ZM6.25 13L9.75 13L9.75 13.65C9.75 14.207 9.75 14.561 9.53 14.78C9.311 15 8.957 15 8.4 15L7.6 15C7.043 15 6.689 15 6.47 14.78C6.25 14.561 6.25 14.207 6.25 13.65Z" />
        </g>
        <g data-l="2" data-layer="detail">
          <path d="M5.25 6A2.75 2.75 0 0 1 8 3.25" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
        </g>
      </g>
    </Glyph>
  )
}
/**
 * 任务看板: Kubai `layout-dashboard` — dashboard whose panes unfold out of the split.
 * @param props - requested size and optional panel identity.
 * @returns the task-board glyph.
 */
export function TaskBoardGlyph({ size, panelId }: NavGlyphProps) {
  return (
    <Glyph name="task-board" size={size} panelId={panelId}>

      <g transform="translate(8 8) scale(1.083) translate(-8 -8)">
        <g data-l="all">
          <g data-l="0" data-layer="main">
            <path d="M2 5.6C2 4.114 2 3.172 2.586 2.586C3.172 2 4.114 2 5.6 2L5.7 2C6.443 2 6.914 2 7.207 2.293C7.5 2.586 7.5 3.057 7.5 3.8L7.5 7.2C7.5 7.943 7.5 8.414 7.207 8.707C6.914 9 6.443 9 5.7 9L3.8 9C3.057 9 2.586 9 2.293 8.707C2 8.414 2 7.943 2 7.2Z" />
          </g>
          <g data-l="1" data-layer="soft">
            <path d="M2 11.333C2 11.057 2 10.586 2.293 10.293C2.586 10 3.057 10 3.333 10L5.7 10C6.443 10 6.914 10 7.207 10.293C7.5 10.586 7.5 11.057 7.5 11.8L7.5 12.2C7.5 12.943 7.5 13.414 7.207 13.707C6.914 14 6.443 14 5.7 14L4.667 14C4.114 14 3.172 14 2.586 13.414C2 12.828 2 11.886 2 11.333Z" />
          </g>
          <g data-l="2" data-layer="soft">
            <path d="M8.5 3.8C8.5 3.057 8.5 2.586 8.793 2.293C9.086 2 9.557 2 10.3 2L11.333 2C11.886 2 12.828 2 13.414 2.586C14 3.172 14 4.114 14 4.667L14 4.667C14 4.943 14 5.414 13.707 5.707C13.414 6 12.943 6 12.667 6L10.3 6C9.557 6 9.086 6 8.793 5.707C8.5 5.414 8.5 4.943 8.5 4.2Z" />
          </g>
          <g data-l="3" data-layer="soft">
            <path d="M8.5 8.8C8.5 8.057 8.5 7.586 8.793 7.293C9.086 7 9.557 7 10.3 7L12.2 7C12.943 7 13.414 7 13.707 7.293C14 7.586 14 8.057 14 8.8L14 10.4C14 11.886 14 12.828 13.414 13.414C12.828 14 11.886 14 10.4 14L10.3 14C9.557 14 9.086 14 8.793 13.707C8.5 13.414 8.5 12.943 8.5 12.2Z" />
          </g>
        </g>
      </g>
    </Glyph>
  )
}
/**
 * Bot Team: Kubai `bot` — robot whose antenna swings and eyes blink.
 * @param props - requested size and optional panel identity.
 * @returns the bot-team glyph.
 */
export function BotTeamGlyph({ size, panelId }: NavGlyphProps) {
  const maskId = 'dsh-nav-bot-team-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <Glyph name="bot-team" size={size} panelId={panelId}>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-2" y="-2" width="20" height="20">
          <rect x="-2" y="-2" width="20" height="20" fill="#fff" />
          <g data-l="1">
            <path d="M2 8.6C2 7.114 2 6.172 2.586 5.586C3.172 5 4.114 5 5.6 5L10.4 5C11.886 5 12.828 5 13.414 5.586C14 6.172 14 7.114 14 8.6L14 10.4C14 11.886 14 12.828 13.414 13.414C12.828 14 11.886 14 10.4 14L5.6 14C4.114 14 3.172 14 2.586 13.414C2 12.828 2 11.886 2 10.4Z" fill="#000" stroke="#000" strokeWidth="1.846" strokeLinejoin="round" />
          </g>
        </mask>
      </defs>
      <g transform="translate(8 8) scale(1.083) translate(-8 -8)">
        <g data-l="all">
          <g mask={`url(#${maskId})`}>
            <g data-l="0" data-layer="main">
              <path d="M7.375 3.625C7.375 3.28 7.655 3 8 3L8 3C8.345 3 8.625 3.28 8.625 3.625L8.625 5.875C8.625 6.22 8.345 6.5 8 6.5L8 6.5C7.655 6.5 7.375 6.22 7.375 5.875ZM7 3A1 1 0 1 1 9 3A1 1 0 1 1 7 3Z" />
            </g>
          </g>
          <g data-l="1" data-layer="soft">
            <path d="M2 8.6C2 7.114 2 6.172 2.586 5.586C3.172 5 4.114 5 5.6 5L10.4 5C11.886 5 12.828 5 13.414 5.586C14 6.172 14 7.114 14 8.6L14 10.4C14 11.886 14 12.828 13.414 13.414C12.828 14 11.886 14 10.4 14L5.6 14C4.114 14 3.172 14 2.586 13.414C2 12.828 2 11.886 2 10.4Z" />
          </g>
          <g data-l="2" data-layer="main">
            <path d="M4.625 9.5A1.125 1.125 0 1 1 6.875 9.5A1.125 1.125 0 1 1 4.625 9.5Z" />
          </g>
          <g data-l="3" data-layer="main">
            <path d="M9.125 9.5A1.125 1.125 0 1 1 11.375 9.5A1.125 1.125 0 1 1 9.125 9.5Z" />
          </g>
        </g>
      </g>
    </Glyph>
  )
}
/**
 * 更多: Kubai `grid` — grid whose cells pop back into place.
 * @param props - requested size and optional panel identity.
 * @returns the more glyph.
 */
export function MoreGlyph({ size, panelId }: NavGlyphProps) {
  const q0Id = 'dsh-nav-more-q0-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const q1Id = 'dsh-nav-more-q1-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const q2Id = 'dsh-nav-more-q2-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const q3Id = 'dsh-nav-more-q3-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <Glyph name="more" size={size} panelId={panelId}>
      <defs>
        <clipPath id={q0Id} clipPathUnits="userSpaceOnUse">
          <rect x="0" y="0" width="8" height="8" />
        </clipPath>
        <clipPath id={q1Id} clipPathUnits="userSpaceOnUse">
          <rect x="8" y="0" width="8" height="8" />
        </clipPath>
        <clipPath id={q2Id} clipPathUnits="userSpaceOnUse">
          <rect x="0" y="8" width="8" height="8" />
        </clipPath>
        <clipPath id={q3Id} clipPathUnits="userSpaceOnUse">
          <rect x="8" y="8" width="8" height="8" />
        </clipPath>
      </defs>
      <g transform="translate(8 8) scale(1.083) translate(-8 -8)">
        <g data-l="all">
          <g data-l="q0" data-layer="soft" clipPath={`url(#${q0Id})`}>
            <path d="M2 3.667C2 3.057 2 2.586 2.293 2.293C2.586 2 3.057 2 3.667 2L3.667 2C4.276 2 4.748 2 5.04 2.293C5.333 2.586 5.333 3.057 5.333 3.667L5.333 3.667C5.333 4.276 5.333 4.748 5.04 5.04C4.748 5.333 4.276 5.333 3.667 5.333L3.667 5.333C3.057 5.333 2.586 5.333 2.293 5.04C2 4.748 2 4.276 2 3.667ZM2 8C2 7.39 2 6.919 2.293 6.626C2.586 6.333 3.057 6.333 3.667 6.333L3.667 6.333C4.276 6.333 4.748 6.333 5.04 6.626C5.333 6.919 5.333 7.39 5.333 8L5.333 8C5.333 8.61 5.333 9.081 5.04 9.374C4.748 9.667 4.276 9.667 3.667 9.667L3.667 9.667C3.057 9.667 2.586 9.667 2.293 9.374C2 9.081 2 8.61 2 8ZM2 12.333C2 11.724 2 11.252 2.293 10.96C2.586 10.667 3.057 10.667 3.667 10.667L3.667 10.667C4.276 10.667 4.748 10.667 5.04 10.96C5.333 11.252 5.333 11.724 5.333 12.333L5.333 12.333C5.333 12.943 5.333 13.414 5.04 13.707C4.748 14 4.276 14 3.667 14L3.667 14C3.057 14 2.586 14 2.293 13.707C2 13.414 2 12.943 2 12.333ZM6.333 3.667C6.333 3.057 6.333 2.586 6.626 2.293C6.919 2 7.39 2 8 2L8 2C8.61 2 9.081 2 9.374 2.293C9.667 2.586 9.667 3.057 9.667 3.667L9.667 3.667C9.667 4.276 9.667 4.748 9.374 5.04C9.081 5.333 8.61 5.333 8 5.333L8 5.333C7.39 5.333 6.919 5.333 6.626 5.04C6.333 4.748 6.333 4.276 6.333 3.667ZM6.333 12.333C6.333 11.724 6.333 11.252 6.626 10.96C6.919 10.667 7.39 10.667 8 10.667L8 10.667C8.61 10.667 9.081 10.667 9.374 10.96C9.667 11.252 9.667 11.724 9.667 12.333L9.667 12.333C9.667 12.943 9.667 13.414 9.374 13.707C9.081 14 8.61 14 8 14L8 14C7.39 14 6.919 14 6.626 13.707C6.333 13.414 6.333 12.943 6.333 12.333ZM10.667 3.667C10.667 3.057 10.667 2.586 10.96 2.293C11.252 2 11.724 2 12.333 2L12.333 2C12.943 2 13.414 2 13.707 2.293C14 2.586 14 3.057 14 3.667L14 3.667C14 4.276 14 4.748 13.707 5.04C13.414 5.333 12.943 5.333 12.333 5.333L12.333 5.333C11.724 5.333 11.252 5.333 10.96 5.04C10.667 4.748 10.667 4.276 10.667 3.667ZM10.667 8C10.667 7.39 10.667 6.919 10.96 6.626C11.252 6.333 11.724 6.333 12.333 6.333L12.333 6.333C12.943 6.333 13.414 6.333 13.707 6.626C14 6.919 14 7.39 14 8L14 8C14 8.61 14 9.081 13.707 9.374C13.414 9.667 12.943 9.667 12.333 9.667L12.333 9.667C11.724 9.667 11.252 9.667 10.96 9.374C10.667 9.081 10.667 8.61 10.667 8ZM10.667 12.333C10.667 11.724 10.667 11.252 10.96 10.96C11.252 10.667 11.724 10.667 12.333 10.667L12.333 10.667C12.943 10.667 13.414 10.667 13.707 10.96C14 11.252 14 11.724 14 12.333L14 12.333C14 12.943 14 13.414 13.707 13.707C13.414 14 12.943 14 12.333 14L12.333 14C11.724 14 11.252 14 10.96 13.707C10.667 13.414 10.667 12.943 10.667 12.333Z" />
          </g>
          <g data-l="q1" data-layer="soft" clipPath={`url(#${q1Id})`}>
            <path d="M2 3.667C2 3.057 2 2.586 2.293 2.293C2.586 2 3.057 2 3.667 2L3.667 2C4.276 2 4.748 2 5.04 2.293C5.333 2.586 5.333 3.057 5.333 3.667L5.333 3.667C5.333 4.276 5.333 4.748 5.04 5.04C4.748 5.333 4.276 5.333 3.667 5.333L3.667 5.333C3.057 5.333 2.586 5.333 2.293 5.04C2 4.748 2 4.276 2 3.667ZM2 8C2 7.39 2 6.919 2.293 6.626C2.586 6.333 3.057 6.333 3.667 6.333L3.667 6.333C4.276 6.333 4.748 6.333 5.04 6.626C5.333 6.919 5.333 7.39 5.333 8L5.333 8C5.333 8.61 5.333 9.081 5.04 9.374C4.748 9.667 4.276 9.667 3.667 9.667L3.667 9.667C3.057 9.667 2.586 9.667 2.293 9.374C2 9.081 2 8.61 2 8ZM2 12.333C2 11.724 2 11.252 2.293 10.96C2.586 10.667 3.057 10.667 3.667 10.667L3.667 10.667C4.276 10.667 4.748 10.667 5.04 10.96C5.333 11.252 5.333 11.724 5.333 12.333L5.333 12.333C5.333 12.943 5.333 13.414 5.04 13.707C4.748 14 4.276 14 3.667 14L3.667 14C3.057 14 2.586 14 2.293 13.707C2 13.414 2 12.943 2 12.333ZM6.333 3.667C6.333 3.057 6.333 2.586 6.626 2.293C6.919 2 7.39 2 8 2L8 2C8.61 2 9.081 2 9.374 2.293C9.667 2.586 9.667 3.057 9.667 3.667L9.667 3.667C9.667 4.276 9.667 4.748 9.374 5.04C9.081 5.333 8.61 5.333 8 5.333L8 5.333C7.39 5.333 6.919 5.333 6.626 5.04C6.333 4.748 6.333 4.276 6.333 3.667ZM6.333 12.333C6.333 11.724 6.333 11.252 6.626 10.96C6.919 10.667 7.39 10.667 8 10.667L8 10.667C8.61 10.667 9.081 10.667 9.374 10.96C9.667 11.252 9.667 11.724 9.667 12.333L9.667 12.333C9.667 12.943 9.667 13.414 9.374 13.707C9.081 14 8.61 14 8 14L8 14C7.39 14 6.919 14 6.626 13.707C6.333 13.414 6.333 12.943 6.333 12.333ZM10.667 3.667C10.667 3.057 10.667 2.586 10.96 2.293C11.252 2 11.724 2 12.333 2L12.333 2C12.943 2 13.414 2 13.707 2.293C14 2.586 14 3.057 14 3.667L14 3.667C14 4.276 14 4.748 13.707 5.04C13.414 5.333 12.943 5.333 12.333 5.333L12.333 5.333C11.724 5.333 11.252 5.333 10.96 5.04C10.667 4.748 10.667 4.276 10.667 3.667ZM10.667 8C10.667 7.39 10.667 6.919 10.96 6.626C11.252 6.333 11.724 6.333 12.333 6.333L12.333 6.333C12.943 6.333 13.414 6.333 13.707 6.626C14 6.919 14 7.39 14 8L14 8C14 8.61 14 9.081 13.707 9.374C13.414 9.667 12.943 9.667 12.333 9.667L12.333 9.667C11.724 9.667 11.252 9.667 10.96 9.374C10.667 9.081 10.667 8.61 10.667 8ZM10.667 12.333C10.667 11.724 10.667 11.252 10.96 10.96C11.252 10.667 11.724 10.667 12.333 10.667L12.333 10.667C12.943 10.667 13.414 10.667 13.707 10.96C14 11.252 14 11.724 14 12.333L14 12.333C14 12.943 14 13.414 13.707 13.707C13.414 14 12.943 14 12.333 14L12.333 14C11.724 14 11.252 14 10.96 13.707C10.667 13.414 10.667 12.943 10.667 12.333Z" />
          </g>
          <g data-l="q2" data-layer="soft" clipPath={`url(#${q2Id})`}>
            <path d="M2 3.667C2 3.057 2 2.586 2.293 2.293C2.586 2 3.057 2 3.667 2L3.667 2C4.276 2 4.748 2 5.04 2.293C5.333 2.586 5.333 3.057 5.333 3.667L5.333 3.667C5.333 4.276 5.333 4.748 5.04 5.04C4.748 5.333 4.276 5.333 3.667 5.333L3.667 5.333C3.057 5.333 2.586 5.333 2.293 5.04C2 4.748 2 4.276 2 3.667ZM2 8C2 7.39 2 6.919 2.293 6.626C2.586 6.333 3.057 6.333 3.667 6.333L3.667 6.333C4.276 6.333 4.748 6.333 5.04 6.626C5.333 6.919 5.333 7.39 5.333 8L5.333 8C5.333 8.61 5.333 9.081 5.04 9.374C4.748 9.667 4.276 9.667 3.667 9.667L3.667 9.667C3.057 9.667 2.586 9.667 2.293 9.374C2 9.081 2 8.61 2 8ZM2 12.333C2 11.724 2 11.252 2.293 10.96C2.586 10.667 3.057 10.667 3.667 10.667L3.667 10.667C4.276 10.667 4.748 10.667 5.04 10.96C5.333 11.252 5.333 11.724 5.333 12.333L5.333 12.333C5.333 12.943 5.333 13.414 5.04 13.707C4.748 14 4.276 14 3.667 14L3.667 14C3.057 14 2.586 14 2.293 13.707C2 13.414 2 12.943 2 12.333ZM6.333 3.667C6.333 3.057 6.333 2.586 6.626 2.293C6.919 2 7.39 2 8 2L8 2C8.61 2 9.081 2 9.374 2.293C9.667 2.586 9.667 3.057 9.667 3.667L9.667 3.667C9.667 4.276 9.667 4.748 9.374 5.04C9.081 5.333 8.61 5.333 8 5.333L8 5.333C7.39 5.333 6.919 5.333 6.626 5.04C6.333 4.748 6.333 4.276 6.333 3.667ZM6.333 12.333C6.333 11.724 6.333 11.252 6.626 10.96C6.919 10.667 7.39 10.667 8 10.667L8 10.667C8.61 10.667 9.081 10.667 9.374 10.96C9.667 11.252 9.667 11.724 9.667 12.333L9.667 12.333C9.667 12.943 9.667 13.414 9.374 13.707C9.081 14 8.61 14 8 14L8 14C7.39 14 6.919 14 6.626 13.707C6.333 13.414 6.333 12.943 6.333 12.333ZM10.667 3.667C10.667 3.057 10.667 2.586 10.96 2.293C11.252 2 11.724 2 12.333 2L12.333 2C12.943 2 13.414 2 13.707 2.293C14 2.586 14 3.057 14 3.667L14 3.667C14 4.276 14 4.748 13.707 5.04C13.414 5.333 12.943 5.333 12.333 5.333L12.333 5.333C11.724 5.333 11.252 5.333 10.96 5.04C10.667 4.748 10.667 4.276 10.667 3.667ZM10.667 8C10.667 7.39 10.667 6.919 10.96 6.626C11.252 6.333 11.724 6.333 12.333 6.333L12.333 6.333C12.943 6.333 13.414 6.333 13.707 6.626C14 6.919 14 7.39 14 8L14 8C14 8.61 14 9.081 13.707 9.374C13.414 9.667 12.943 9.667 12.333 9.667L12.333 9.667C11.724 9.667 11.252 9.667 10.96 9.374C10.667 9.081 10.667 8.61 10.667 8ZM10.667 12.333C10.667 11.724 10.667 11.252 10.96 10.96C11.252 10.667 11.724 10.667 12.333 10.667L12.333 10.667C12.943 10.667 13.414 10.667 13.707 10.96C14 11.252 14 11.724 14 12.333L14 12.333C14 12.943 14 13.414 13.707 13.707C13.414 14 12.943 14 12.333 14L12.333 14C11.724 14 11.252 14 10.96 13.707C10.667 13.414 10.667 12.943 10.667 12.333Z" />
          </g>
          <g data-l="q3" data-layer="soft" clipPath={`url(#${q3Id})`}>
            <path d="M2 3.667C2 3.057 2 2.586 2.293 2.293C2.586 2 3.057 2 3.667 2L3.667 2C4.276 2 4.748 2 5.04 2.293C5.333 2.586 5.333 3.057 5.333 3.667L5.333 3.667C5.333 4.276 5.333 4.748 5.04 5.04C4.748 5.333 4.276 5.333 3.667 5.333L3.667 5.333C3.057 5.333 2.586 5.333 2.293 5.04C2 4.748 2 4.276 2 3.667ZM2 8C2 7.39 2 6.919 2.293 6.626C2.586 6.333 3.057 6.333 3.667 6.333L3.667 6.333C4.276 6.333 4.748 6.333 5.04 6.626C5.333 6.919 5.333 7.39 5.333 8L5.333 8C5.333 8.61 5.333 9.081 5.04 9.374C4.748 9.667 4.276 9.667 3.667 9.667L3.667 9.667C3.057 9.667 2.586 9.667 2.293 9.374C2 9.081 2 8.61 2 8ZM2 12.333C2 11.724 2 11.252 2.293 10.96C2.586 10.667 3.057 10.667 3.667 10.667L3.667 10.667C4.276 10.667 4.748 10.667 5.04 10.96C5.333 11.252 5.333 11.724 5.333 12.333L5.333 12.333C5.333 12.943 5.333 13.414 5.04 13.707C4.748 14 4.276 14 3.667 14L3.667 14C3.057 14 2.586 14 2.293 13.707C2 13.414 2 12.943 2 12.333ZM6.333 3.667C6.333 3.057 6.333 2.586 6.626 2.293C6.919 2 7.39 2 8 2L8 2C8.61 2 9.081 2 9.374 2.293C9.667 2.586 9.667 3.057 9.667 3.667L9.667 3.667C9.667 4.276 9.667 4.748 9.374 5.04C9.081 5.333 8.61 5.333 8 5.333L8 5.333C7.39 5.333 6.919 5.333 6.626 5.04C6.333 4.748 6.333 4.276 6.333 3.667ZM6.333 12.333C6.333 11.724 6.333 11.252 6.626 10.96C6.919 10.667 7.39 10.667 8 10.667L8 10.667C8.61 10.667 9.081 10.667 9.374 10.96C9.667 11.252 9.667 11.724 9.667 12.333L9.667 12.333C9.667 12.943 9.667 13.414 9.374 13.707C9.081 14 8.61 14 8 14L8 14C7.39 14 6.919 14 6.626 13.707C6.333 13.414 6.333 12.943 6.333 12.333ZM10.667 3.667C10.667 3.057 10.667 2.586 10.96 2.293C11.252 2 11.724 2 12.333 2L12.333 2C12.943 2 13.414 2 13.707 2.293C14 2.586 14 3.057 14 3.667L14 3.667C14 4.276 14 4.748 13.707 5.04C13.414 5.333 12.943 5.333 12.333 5.333L12.333 5.333C11.724 5.333 11.252 5.333 10.96 5.04C10.667 4.748 10.667 4.276 10.667 3.667ZM10.667 8C10.667 7.39 10.667 6.919 10.96 6.626C11.252 6.333 11.724 6.333 12.333 6.333L12.333 6.333C12.943 6.333 13.414 6.333 13.707 6.626C14 6.919 14 7.39 14 8L14 8C14 8.61 14 9.081 13.707 9.374C13.414 9.667 12.943 9.667 12.333 9.667L12.333 9.667C11.724 9.667 11.252 9.667 10.96 9.374C10.667 9.081 10.667 8.61 10.667 8ZM10.667 12.333C10.667 11.724 10.667 11.252 10.96 10.96C11.252 10.667 11.724 10.667 12.333 10.667L12.333 10.667C12.943 10.667 13.414 10.667 13.707 10.96C14 11.252 14 11.724 14 12.333L14 12.333C14 12.943 14 13.414 13.707 13.707C13.414 14 12.943 14 12.333 14L12.333 14C11.724 14 11.252 14 10.96 13.707C10.667 13.414 10.667 12.943 10.667 12.333Z" />
          </g>
          <g data-l="1" data-layer="main">
            <path d="M6.333 8C6.333 7.39 6.333 6.919 6.626 6.626C6.919 6.333 7.39 6.333 8 6.333L8 6.333C8.61 6.333 9.081 6.333 9.374 6.626C9.667 6.919 9.667 7.39 9.667 8L9.667 8C9.667 8.61 9.667 9.081 9.374 9.374C9.081 9.667 8.61 9.667 8 9.667L8 9.667C7.39 9.667 6.919 9.667 6.626 9.374C6.333 9.081 6.333 8.61 6.333 8Z" />
          </g>
        </g>
      </g>
    </Glyph>
  )
}

/**
 * 新会话: Kubai `pencil` — gold-to-orange pencil that writes on hover.
 * @param props - requested size and optional panel identity.
 * @returns the new-session glyph.
 */
export function NewSessionGlyph({ size, panelId }: NavGlyphProps) {
  const clipId = 'dsh-nav-new-session-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const gradId = 'dsh-nav-new-session-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <Glyph name="new-session" size={size} panelId={panelId}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="16" x2="16" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--nav-color-new-session)" />
          <stop offset="1" stopColor="var(--nav-color-new-session-to)" />
        </linearGradient>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <path d="M-6 2.828L12 20.828L-6 20.828Z" />
        </clipPath>
      </defs>
      <g transform="translate(8 8) scale(1.083) translate(-8 -8)">
        <g data-l="all">
          <g data-l="0" data-layer="soft">
            <path d="M3.8 14C3.057 14 2.586 14 2.293 13.707C2 13.414 2 12.943 2 12.2L2 11.172L9.286 3.886L12.114 6.714L4.828 14Z" />
          </g>
          <g data-l="1" data-layer="main">
            <g clipPath={`url(#${clipId})`}>
              <path
                d="M3.8 14C3.057 14 2.586 14 2.293 13.707C2 13.414 2 12.943 2 12.2L2 11.172L9.286 3.886L12.114 6.714L4.828 14Z"
                pathLength={1}
                style={{ fill: `url(#${gradId})`, stroke: `url(#${gradId})`, strokeWidth: 0.6 }}
              />
            </g>
          </g>
          <g data-l="2" data-layer="main">
            <path
              d="M9.993 3.178L10.311 2.86C10.837 2.335 11.17 2.002 11.584 2.002C11.998 2.002 12.332 2.335 12.857 2.86L13.14 3.143C13.665 3.668 13.998 4.002 13.998 4.416C13.998 4.83 13.665 5.163 13.14 5.689L12.822 6.007Z"
              style={{ fill: `url(#${gradId})`, stroke: `url(#${gradId})`, strokeWidth: 0.6 }}
            />
          </g>
          <g data-l="3" data-layer="flow">
            <path
              d="M3.8 14C3.057 14 2.586 14 2.293 13.707C2 13.414 2 12.943 2 12.2L2 11.172L9.286 3.886L12.114 6.714L4.828 14Z"
              pathLength={1}
              opacity={0}
              strokeDasharray="0.16 0.3"
              style={{ fill: 'none', stroke: `url(#${gradId})`, strokeWidth: 1.6 }}
            />
          </g>
        </g>
      </g>
    </Glyph>
  )
}

/**
 * 工作区: Kubai `folder` — the section glyph the browsing region never had; its
 * body lifts while the front panel settles when the header is hovered.
 * @param props - requested size.
 * @returns the folder glyph.
 */
export function WorkspaceGlyph({ size }: NavGlyphProps) {
  const maskId = 'dsh-nav-workspace-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <Glyph name="workspace" size={size}>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-2" y="-2" width="20" height="20">
          <rect x="-2" y="-2" width="20" height="20" fill="#fff" />
          <g data-l="1">
            <path d="M1 4.7C1 3.586 1 2.879 1.439 2.439C1.879 2 2.586 2 3.7 2L5 2C5.415 2 6.121 2 6.561 2.439C7 2.879 7 3.586 7 4L7 4L10.5 4C12.357 4 13.536 4 14.268 4.732C15 5.464 15 6.643 15 8.5L15 9.5C15 11.357 15 12.536 14.268 13.268C13.536 14 12.357 14 10.5 14L5.5 14C3.643 14 2.464 14 1.732 13.268C1 12.536 1 11.357 1 9.5Z" fill="#000" stroke="#000" strokeWidth={2} strokeLinejoin="round" />
          </g>
        </mask>
      </defs>
      <g data-l="all">
        <g mask={`url(#${maskId})`}>
          <g data-l="0" data-layer="main">
            <path d="M6.5 8.2C6.5 7.085 6.5 6.379 6.939 5.939C7.379 5.5 8.085 5.5 9.2 5.5L10.3 5.5C11.415 5.5 12.121 5.5 12.561 5.939C13 6.379 13 7.085 13 8.2L13 9.3C13 10.415 13 11.121 12.561 11.561C12.121 12 11.415 12 10.3 12L9.2 12C8.085 12 7.379 12 6.939 11.561C6.5 11.121 6.5 10.415 6.5 9.3Z" />
          </g>
        </g>
        <g data-l="1" data-layer="soft">
          <path d="M1 4.7C1 3.586 1 2.879 1.439 2.439C1.879 2 2.586 2 3.7 2L5 2C5.415 2 6.121 2 6.561 2.439C7 2.879 7 3.586 7 4L7 4L10.5 4C12.357 4 13.536 4 14.268 4.732C15 5.464 15 6.643 15 8.5L15 9.5C15 11.357 15 12.536 14.268 13.268C13.536 14 12.357 14 10.5 14L5.5 14C3.643 14 2.464 14 1.732 13.268C1 12.536 1 11.357 1 9.5Z" />
        </g>
        <g data-l="2" data-layer="main">
          <path d="M9 11.375C9 11.03 9.28 10.75 9.625 10.75L12.375 10.75C12.72 10.75 13 11.03 13 11.375L13 11.375C13 11.72 12.72 12 12.375 12L9.625 12C9.28 12 9 11.72 9 11.375Z" />
        </g>
      </g>
    </Glyph>
  )
}

/**
 * Resolve one nav glyph by identity.
 * @param name - glyph identity.
 * @param props - requested size and optional panel identity.
 * @returns the matching glyph element.
 */
export function NavGlyph({ name, ...props }: NavGlyphProps & { name: NavGlyphName }) {
  switch (name) {
    case 'task-center': return <TaskCenterGlyph {...props} />
    case 'task-board': return <TaskBoardGlyph {...props} />
    case 'context-insight': return <ContextInsightGlyph {...props} />
    case 'bot-team': return <BotTeamGlyph {...props} />
    case 'more': return <MoreGlyph {...props} />
    case 'new-session': return <NewSessionGlyph {...props} />
    case 'workspace': return <WorkspaceGlyph {...props} />
  }
}
