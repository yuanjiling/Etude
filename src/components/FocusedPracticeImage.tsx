import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { FocusRegion, ImageRecord } from '../types';

type Size = { width: number; height: number };

export const FocusedPracticeImage: React.FC<{
  image: ImageRecord;
  region?: FocusRegion;
  flipped: boolean;
  grayscale: boolean;
  active?: boolean;
  src?: string;
  quickFade?: boolean;
  animateFlip?: boolean;
  onImageError?: () => void;
}> = ({ image, region, flipped, grayscale, active = true, src, quickFade = false, animateFlip = true, onImageError }) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [frame, setFrame] = useState<Size>({ width: 0, height: 0 });
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 });
  const [loaded, setLoaded] = useState(false);
  const revealFrameRef = useRef<number | null>(null);
  const imageSrc = src || image.url;

  useEffect(() => {
    setLoaded(false);
    setNatural({ width: 0, height: 0 });
    return () => {
      if (revealFrameRef.current !== null) cancelAnimationFrame(revealFrameRef.current);
    };
  }, [imageSrc]);

  const reveal = () => {
    if (!quickFade) {
      setLoaded(true);
      return;
    }
    if (revealFrameRef.current !== null) cancelAnimationFrame(revealFrameRef.current);
    revealFrameRef.current = requestAnimationFrame(() => {
      revealFrameRef.current = requestAnimationFrame(() => {
        setLoaded(true);
        revealFrameRef.current = null;
      });
    });
  };

  const acceptLoadedImage = (element: HTMLImageElement) => {
    if (element.naturalWidth <= 0 || element.naturalHeight <= 0) return;
    setNatural({ width: element.naturalWidth, height: element.naturalHeight });
    reveal();
  };

  useEffect(() => {
    const element = imageRef.current;
    if (!element) return;
    let disposed = false;
    const accept = () => {
      if (!disposed && element.src === imageRef.current?.src) acceptLoadedImage(element);
    };
    if (element.complete && element.naturalWidth > 0) accept();
    else element.decode().then(accept).catch(() => undefined);
    return () => { disposed = true; };
  }, [imageSrc]);

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const update = () => setFrame({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const transform = useMemo(() => {
    if (!region || !frame.width || !frame.height || !natural.width || !natural.height) return null;
    let regionWidth = region.width * natural.width;
    let regionHeight = region.height * natural.height;
    if (region.tag === '手' || region.tag === '足') {
      const aspect = regionWidth / regionHeight;
      if (aspect < 0.65) regionWidth = regionHeight * 0.65;
      if (aspect > 1.5) regionHeight = regionWidth / 1.5;
    }
    const scale = Math.min(frame.width / regionWidth, frame.height / regionHeight);
    const centerX = (region.x + region.width / 2) * natural.width;
    const centerY = (region.y + region.height / 2) * natural.height;
    const translateX = flipped
      ? frame.width / 2 + scale * centerX
      : frame.width / 2 - scale * centerX;
    const translateY = frame.height / 2 - scale * centerY;
    return `matrix(${flipped ? -scale : scale}, 0, 0, ${scale}, ${translateX}, ${translateY})`;
  }, [flipped, frame, natural, region]);

  return (
    <motion.div
      ref={frameRef}
      initial={quickFade ? false : { opacity: 0, filter: 'blur(12px)' }}
      animate={{ opacity: 1, filter: grayscale ? 'blur(0px) grayscale(100%)' : 'blur(0px) grayscale(0%)' }}
      exit={{ opacity: 0, filter: 'blur(12px)' }}
      transition={{ duration: quickFade ? 0.18 : 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-0 overflow-hidden pointer-events-none"
    >
      {quickFade && (
        <div className={`absolute inset-0 bg-gradient-to-br from-stone-200 via-stone-100 to-stone-200 transition-opacity duration-300 dark:from-zinc-800 dark:via-zinc-700 dark:to-zinc-800 ${loaded ? 'opacity-0' : 'opacity-100'}`} />
      )}
      {active && (
        <img
          ref={imageRef}
          src={imageSrc}
          alt={image.fileName || ''}
          loading="eager"
          decoding="async"
          onLoad={event => acceptLoadedImage(event.currentTarget)}
          onError={onImageError}
          className={`${region ? 'absolute left-0 top-0 max-w-none max-h-none' : 'w-full h-full object-contain'} will-change-[opacity,transform] ${loaded ? 'opacity-100' : 'opacity-0'}`}
          style={region && transform ? {
            width: natural.width,
            height: natural.height,
            transform,
            transformOrigin: '0 0',
            transition: `${animateFlip ? 'transform 800ms cubic-bezier(0.16, 1, 0.3, 1)' : 'transform 0ms'}, opacity ${quickFade ? 300 : 200}ms ease-out`,
          } : {
            transform: flipped ? 'scaleX(-1)' : undefined,
            transition: `${animateFlip ? 'transform 800ms cubic-bezier(0.16, 1, 0.3, 1)' : 'transform 0ms'}, opacity ${quickFade ? 300 : 200}ms ease-out`,
          }}
        />
      )}
    </motion.div>
  );
};
