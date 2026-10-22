import type { Settings } from "./types";

/** Adresse des ImmoFriend-Proxys (Cloudflare Worker); nur in der öffentlichen Version gesetzt */
export const PROXY_URL: string = import.meta.env.VITE_PROXY_URL ?? "";

/** Zugang zur Belegerkennung: eigener API-Schlüssel oder Einladungscode über den Proxy */
export type AiAccess = { kind: "key"; apiKey: string } | { kind: "invite"; code: string; proxyUrl: string };

/** Der eigene Schlüssel hat Vorrang; ohne beides gibt es keine automatische Erkennung */
export function aiAccess(settings: Settings): AiAccess | null {
  if (settings.anthropicApiKey) return { kind: "key", apiKey: settings.anthropicApiKey };
  if (PROXY_URL && settings.inviteCode) return { kind: "invite", code: settings.inviteCode, proxyUrl: PROXY_URL };
  return null;
}
