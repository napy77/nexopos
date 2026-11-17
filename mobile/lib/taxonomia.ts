import { useEffect, useState } from "react";
import { api } from "./api";
import type { B2BTaxonomia } from "./b2b";

// Cambia muy de vez en cuando (el backend ya la guarda una hora): se trae una
// vez por apertura de la app y la comparten todas las pantallas.
let cache: Promise<B2BTaxonomia> | null = null;

export function useTaxonomia(): B2BTaxonomia | null {
  const [t, setT] = useState<B2BTaxonomia | null>(null);
  useEffect(() => {
    cache ??= api<B2BTaxonomia>("/api/catalog/taxonomia");
    let vivo = true;
    cache.then((d) => { if (vivo) setT(d); }).catch(() => { cache = null; });
    return () => { vivo = false; };
  }, []);
  return t;
}
