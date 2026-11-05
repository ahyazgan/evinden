/** Afiyetli marka renkleri: antrasit ve limon */
export const colors = {
  /** Antrasit: ana eylem düğmeleri */
  primary: '#2C312E',
  /** Antrasit: koyu yüzeyler */
  secondary: '#2C312E',
  /** Koyu yüzeydeki kutular */
  panel: '#3E4440',
  /** Limon: etkin durum ve onay, üzerine yalnızca koyu yazı */
  lime: '#C8F031',
  /** Sayfa zemini */
  background: '#F1F2EE',
  mint: '#F1F2EE',
  border: '#E3E6DE',
  /** İkincil yazı */
  muted: '#56605A',
  /** Ana yazı */
  ink: '#151A16',
  success: '#2E7D32',
  amber: '#8A5A00',
  danger: '#C62828',
} as const;

export type ThemeColors = typeof colors;
