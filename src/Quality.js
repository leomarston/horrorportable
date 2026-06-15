import { QUALITY } from './config.js';

export function isTouchDevice() {
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

// The game always runs on the Low preset (optimized for any device); there is
// no quality selector.
export function getPreset() {
  return QUALITY.low;
}
