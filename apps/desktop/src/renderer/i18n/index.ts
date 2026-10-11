// Libellés FR/EN. Le français fait référence ; l'anglais doit définir exactement les mêmes clés (vérifié par le
// typage : `en` est de type `Record<TKey, string>`). Interpolation simple `{nom}`.
import { useCallback } from "react";
import { useAppStore, type Lang } from "../stores/app.ts";
import { en } from "./en.ts";
import { fr } from "./fr.ts";

export type { Lang };
export type TKey = keyof typeof fr;
export type TFn = (key: TKey, vars?: Record<string, string | number>) => string;

const dictionaries: Record<Lang, Record<TKey, string>> = { fr, en };

export function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  let text: string = dictionaries[lang][key] ?? fr[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
}

export function useT(): TFn {
  const lang = useAppStore((s) => s.lang);
  return useCallback<TFn>((key, vars) => translate(lang, key, vars), [lang]);
}

/** Traduction hors composant React (commandes, notifications). */
export const tNow: TFn = (key, vars) => translate(useAppStore.getState().lang, key, vars);

/** Libellé dynamique (`prefix` + valeur), avec repli sur la valeur brute si la clé n'existe pas. */
export function useTd(): (prefix: string, value: string) => string {
  const lang = useAppStore((s) => s.lang);
  return useCallback(
    (prefix: string, value: string) => {
      const key = `${prefix}${value}` as TKey;
      return key in fr ? translate(lang, key) : value;
    },
    [lang],
  );
}
