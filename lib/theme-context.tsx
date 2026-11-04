import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

export type ThemeMode = 'light' | 'dark' | 'system';

export type ThemeColors = {
  primary: string;
  /** Asma Yaprağı: ana marka yüzeyi */
  brand: string;
  /** Başlık rengi */
  heading: string;
  /** Nane: sakin vurgu zemini */
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
};

const LIGHT: ThemeColors = {
  primary: '#CE3A1F',
  brand: '#17402F',
  heading: '#17402F',
  mint: '#E6EEDF',
  chip: '#EFF2EA',
  background: '#FAF8F2',
  surface: '#fff',
  surfaceBorder: '#E3E6DE',
  text: '#151A16',
  textSecondary: '#56605A',
  textMuted: '#6B766F',
  cardBg: '#fff',
  inputBg: '#FAF8F2',
  divider: '#EDEFE8',
  success: '#2E7D32',
  amber: '#E3A90F',
};

const DARK: ThemeColors = {
  primary: '#E5603F',
  brand: '#17402F',
  heading: '#F3F5EE',
  mint: '#1E2A22',
  chip: '#1E2A22',
  background: '#0F1712',
  surface: '#18231C',
  surfaceBorder: '#27332B',
  text: '#F3F5EE',
  textSecondary: '#B4BDB6',
  textMuted: '#8A948D',
  cardBg: '#18231C',
  inputBg: '#1E2A22',
  divider: '#27332B',
  success: '#4CAF7A',
  amber: '#F7C948',
};

const STORAGE_KEY = '@evinden_theme_mode';

type ThemeContextValue = {
  mode: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw === 'light' || raw === 'dark' || raw === 'system') {
        setModeState(raw);
      }
    });
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  }, []);

  const isDark = mode === 'dark' || (mode === 'system' && systemScheme === 'dark');
  const colors = isDark ? DARK : LIGHT;

  const value = useMemo(
    () => ({ mode, isDark, colors, setMode }),
    [mode, isDark, colors, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
