import { useWindowDimensions, type ViewStyle } from 'react-native';

/** Bu genişlikten sonra masaüstü düzeni: üst menü, ortalanmış içerik, çok sütun */
export const DESKTOP_BREAKPOINT = 900;
export const PAGE_WIDTH = 1120;
export const NARROW_PAGE_WIDTH = 720;
export const PANEL_PAGE_WIDTH = 1000;
export const NAV_HEIGHT = 68;

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  return {
    isDesktop,
    width,
    height,
    /** İçeriğin gerçek genişliği */
    pageWidth: isDesktop ? Math.min(width, PAGE_WIDTH) : width,
  };
}

/** Sütunlu düzende bir kartın genişliği */
export function gridItemWidth(containerWidth: number, columns: number, gap: number, sidePadding: number): number {
  return Math.floor((containerWidth - sidePadding * 2 - gap * (columns - 1)) / columns);
}

/** Masaüstünde sayfayı ortalar */
export function centeredScene(maxWidth: number): ViewStyle {
  return { width: '100%', maxWidth, alignSelf: 'center' };
}
