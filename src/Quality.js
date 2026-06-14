import { QUALITY } from './config.js';

const STORAGE_KEY = 'ah_quality';

export function isTouchDevice() {
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

/**
 * Best-effort GPU/CPU heuristic → 'low' | 'medium' | 'high'.
 * Conservative on mobile and weak GPUs so the first frame is already smooth.
 */
export function detectTier() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && QUALITY[saved]) return saved;

  let score = 2; // start at medium
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const touch = isTouchDevice();

  if (cores >= 8) score += 1;
  if (cores <= 4) score -= 1;
  if (mem >= 8) score += 1;
  if (mem <= 3) score -= 1;
  if (touch) score -= 1;

  // Inspect the actual renderer string when available.
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || '';
    const s = String(r).toLowerCase();
    if (/apple m\d|rtx|radeon rx|geforce gtx 1[0-9]|geforce rtx|arc a/.test(s)) score += 2;
    else if (/intel|uhd|hd graphics|mali|adreno [1-5]|powervr|swiftshader|llvmpipe/.test(s)) score -= 2;
    else if (/adreno [6-9]|apple gpu/.test(s)) score += 0;
  } catch (e) { /* ignore */ }

  if (score <= 1) return 'low';
  if (score >= 4) return 'high';
  return 'medium';
}

export function getPreset(tier) {
  return QUALITY[tier] || QUALITY.medium;
}

export function saveTier(tier) {
  try { localStorage.setItem(STORAGE_KEY, tier); } catch (e) { /* ignore */ }
}
