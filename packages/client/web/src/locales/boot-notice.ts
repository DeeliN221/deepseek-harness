/** Typed startup-notice copy; the resolved document language selects Chinese or English. */
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

/** English notice dictionary and key source. */
export const en = {
  'notice.one': '1 plugin did not start',
  'notice.many': '{count} plugins did not start',
  'notice.hint': 'The rest of the application keeps running. Settings → Plugins lists installed plugins.',
  'notice.dismiss': 'Dismiss',
} satisfies Record<string, string>

/** Chinese notice dictionary, complete against the English keys. */
export const zh = {
  'notice.one': '1 个插件未启动',
  'notice.many': '{count} 个插件未启动',
  'notice.hint': '应用的其他部分仍可使用。可在设置 → 插件中查看已安装的插件',
  'notice.dismiss': '关闭',
} satisfies Record<keyof typeof en, string>

/**
 * Bind notice copy to the document language resolved by the locale plugin.
 * @param language - Document language; Chinese tags select Chinese, all others select English.
 * @returns Typed translation function with named parameter substitution.
 */
export function bootNoticeTranslator(language: string): Translate<keyof typeof en> {
  const dictionary = /^zh(?:-|$)/i.test(language) ? zh : en
  return (key, params) => dictionary[key].replace(/\{(\w+)\}/g, (placeholder: string, name: string) =>
    params?.[name] === undefined ? placeholder : String(params[name]))
}
