/**
 * Screen Tiers, Scaling, Density and Workspace Height Defaults
 * Spec A2.1:
 * - S: <= 1440px (1366x768, 1440x900)
 * - M: 1441 - 1919px (1536x864, 1600x900)
 * - L: 1920 - 2559px (1080p)
 * - XL: 2560 - 3439px (1440p)
 * - XXL: >= 3440px (Ultrawide, 4K)
 */

export const SCREEN_TIERS = {
  S: {
    id: 'S',
    name: 'Компактный (<= 1440)',
    minWidth: 0,
    maxWidth: 1440,
    defaultDensity: 'compact',
    defaultScale: 0.90,
    defaultWorkspaceHeightRatio: 1.25, // 125% screen height to provide extra room
    headerVisibleMinPriority: 6,
  },
  M: {
    id: 'M',
    name: 'Стандартный (1441 - 1919)',
    minWidth: 1441,
    maxWidth: 1919,
    defaultDensity: 'standard',
    defaultScale: 1.00,
    defaultWorkspaceHeightRatio: 1.00,
    headerVisibleMinPriority: 4,
  },
  L: {
    id: 'L',
    name: 'Full HD (1920 - 2559)',
    minWidth: 1920,
    maxWidth: 2559,
    defaultDensity: 'standard',
    defaultScale: 1.00,
    defaultWorkspaceHeightRatio: 1.00,
    headerVisibleMinPriority: 0,
  },
  XL: {
    id: 'XL',
    name: '2K QHD (2560 - 3439)',
    minWidth: 2560,
    maxWidth: 3439,
    defaultDensity: 'spacious',
    defaultScale: 1.25,
    defaultWorkspaceHeightRatio: 1.00,
    headerVisibleMinPriority: 0,
  },
  XXL: {
    id: 'XXL',
    name: 'Ultrawide / 4K (>= 3440)',
    minWidth: 3440,
    maxWidth: Infinity,
    defaultDensity: 'spacious',
    defaultScale: 1.50,
    defaultWorkspaceHeightRatio: 1.00,
    headerVisibleMinPriority: 0,
  }
};

export function getTierForWidth(width = typeof window !== 'undefined' ? window.innerWidth : 1920) {
  if (width <= 1440) return SCREEN_TIERS.S;
  if (width < 1920) return SCREEN_TIERS.M;
  if (width < 2560) return SCREEN_TIERS.L;
  if (width < 3440) return SCREEN_TIERS.XL;
  return SCREEN_TIERS.XXL;
}

export function calculateAutoScale(width = typeof window !== 'undefined' ? window.innerWidth : 1920) {
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const tier = getTierForWidth(width);
  if (tier.id === 'XXL') {
    return dpr > 1 ? 1.00 : 1.50;
  }
  return tier.defaultScale;
}
