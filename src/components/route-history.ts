import { useEffect, useRef, type RouteEntry, type Router } from 'zapkit-tv';
import { EVENTS } from '../services/api';

export function subscribeRouteHistory(target: EventTarget, router: Pick<Router, 'current' | 'subscribe'>, entry: RouteEntry, callback: () => void): () => void {
  let pending = false;
  const onHistory = () => {
    if (router.current === entry) callback();
    else pending = true;
  };
  const unsubscribe = router.subscribe(() => {
    if (pending && router.current === entry) {
      pending = false;
      callback();
    }
  });
  target.addEventListener(EVENTS.historyUpdated, onHistory);
  return () => {
    target.removeEventListener(EVENTS.historyUpdated, onHistory);
    unsubscribe();
  };
}

export function useRouteHistory(router: Router, entry: RouteEntry, callback: () => void): void {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => subscribeRouteHistory(window, router, entry, () => ref.current()), [router, entry]);
}
