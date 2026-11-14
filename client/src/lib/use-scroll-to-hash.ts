import { useEffect } from 'react';
import { useLocation } from 'react-router';

/**
 * Scrolls to `#id` from the URL (e.g. a notification link to /events/x#proposal-y) once that
 * section has loaded, and briefly highlights it.
 */
export function useScrollToHash(): void {
  const { hash, key } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.getElementById(id);
      if (el || ++tries > 30) clearInterval(timer);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('ring-4', 'ring-brand-300');
      setTimeout(() => el.classList.remove('ring-4', 'ring-brand-300'), 2000);
    }, 100);
    return () => clearInterval(timer);
  }, [hash, key]);
}
