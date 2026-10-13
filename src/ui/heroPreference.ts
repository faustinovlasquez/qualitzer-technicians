import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

/**
 * Tarjeta superior del detalle (orden/mantenimiento o trabajo): el usuario decide si la minimiza y la decisión se
 * conserva en el teléfono al salir y volver a entrar, también tras cerrar la app.
 */
export type HeroCard = "order" | "work";

const cache = new Map<HeroCard, boolean>();
const storageKey = (card: HeroCard) => `qualitzer:hero-collapsed:${card}`;

export function useHeroCollapsed(card: HeroCard): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(cache.get(card) ?? false);
  useEffect(() => {
    if (cache.has(card)) return;
    let active = true;
    AsyncStorage.getItem(storageKey(card)).then((stored) => {
      if (cache.has(card)) return;
      const value = stored === "1";
      cache.set(card, value);
      if (active) setCollapsed(value);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [card]);
  const toggle = useCallback(() => {
    const next = !(cache.get(card) ?? collapsed);
    cache.set(card, next);
    setCollapsed(next);
    void AsyncStorage.setItem(storageKey(card), next ? "1" : "0").catch(() => undefined);
  }, [card, collapsed]);
  return [collapsed, toggle];
}
