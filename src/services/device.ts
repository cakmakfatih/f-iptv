export function isLegacyTvUserAgent(userAgent: string): boolean {
  const match = /\b(?:Chrome|Chromium)\/(\d+)\./.exec(userAgent);
  return match !== null && Number(match[1]) > 0 && Number(match[1]) <= 70;
}

export const isLegacyTv = typeof navigator !== 'undefined' && isLegacyTvUserAgent(navigator.userAgent);
