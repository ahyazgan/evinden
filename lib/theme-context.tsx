import { createContext, useContext, type ReactNode } from 'react';

export type ThemeColors = {
  /** Antrasit: ana düğme */
  primary: string;
  /** Antrasit: üst alan, alt bar ve koyu kartlar */
  brand: string;
  /** Koyu yüzeydeki kutular: arama, geri düğmesi */
  panel: string;
  /** Limon: etkin durum ve onay */
  accent: string;
  /** Limonun üstündeki yazı */
  onAccent: string;
  /** Koyu yüzeydeki yazı */
  onBrand: string;
  /** Koyu yüzeydeki ikincil yazı */
  onBrandSoft: string;
  /** Başlık rengi */
  heading: string;
  /** Sakin vurgu zemini */
  mint: string;
  /** Pasif düğme ve etiket zemini */
  chip: string;
  background: string;
  surface: string;
  surfaceBorder: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  cardBg: string;
  inputBg: string;
  divider: string;
  success: string;
  amber: string;
  danger: string;
};

const LIGHT: ThemeColors = {
  primary: '#2C312E',
  brand: '#2C312E',
  panel: '#3E4440',
  accent: '#C8F031',
  onAccent: '#151A16',
  onBrand: '#FFFFFF',
  onBrandSoft: '#C4CAC5',
  heading: '#151A16',
  mint: '#F1F2EE',
  chip: '#F1F2EE',
  background: '#F1F2EE',
  surface: '#FFFFFF',
  surfaceBorder: '#E3E6DE',
  text: '#151A16',
  textSecondary: '#56605A',
  textMuted: '#5E6862',
  cardBg: '#FFFFFF',
  inputBg: '#F1F2EE',
  divider: '#E3E6DE',
  success: '#2E7D32',
  amber: '#8A5A00',
  danger: '#C62828',
};

const VALUE = { colors: LIGHT };
const ThemeContext = createContext(VALUE);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={VALUE}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
