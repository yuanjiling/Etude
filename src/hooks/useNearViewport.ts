import { useEffect, useRef, useState } from 'react';

export const useNearViewport = <T extends HTMLElement>(rootMargin = '700px 0px') => {
  const ref = useRef<T>(null);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      entries => setIsNear(entries[0]?.isIntersecting ?? false),
      { root: null, rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, isNear };
};
