/** Evinden marka renkleri */
export const colors = {
  /** Salça: ana eylem düğmeleri ve fiyat */
  primary: '#CE3A1F',
  /** Asma Yaprağı: ana marka rengi, koyu yüzeyler */
  secondary: '#17402F',
  /** Un */
  background: '#FAF8F2',
  /** Nane */
  mint: '#E6EEDF',
  /** Limon: yalnızca üzerine yeşil yazı */
  lemon: '#F7C948',
  /** Tepsi */
  border: '#E3E6DE',
  /** Kekik */
  muted: '#56605A',
  /** Zeytin */
  ink: '#151A16',
  success: '#2E7D32',
  amber: '#E3A90F',
} as const;

export type ThemeColors = typeof colors;
