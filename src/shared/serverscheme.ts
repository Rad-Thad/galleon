import type { I18n } from './i18n/index.ts'

/**
 * The note shown beside a connection that is not encrypted, or null.
 *
 * Said wherever the address is: an address typed without a scheme may have
 * been saved as http (see `resolveBaseUrl`), and the user never typed that.
 */
export function schemeNote(i18n: Pick<I18n, 't'>, baseUrl: string | null): string | null {
  return baseUrl !== null && /^http:\/\//i.test(baseUrl)
    ? i18n.t('connect.connectedOverHttp')
    : null
}
