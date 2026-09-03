import { getLocale, t, type SupportedLocale } from "../../shared/i18n";
import { describeMind, type MindSettings } from "../mind/settings";

/** Copy shown when the sanitar stands at the apparatus. */
export function liveEntryBody(
  mindReady: boolean,
  settings: MindSettings | null,
  locale: SupportedLocale = getLocale(),
): string {
  if (mindReady) return t("lobby.entry_ready_body", undefined, locale);
  const reason = settings
    ? describeMind(settings, locale)
    : t("connect.model_not_connected", undefined, locale);
  return `${t("lobby.entry_blocked_body", undefined, locale)}\n\n${reason}`;
}
