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
  primary: '#E8593C',
  background: '#FAF7F2',
  surface: '#fff',
  surfaceBorder: '#EDE8E2',
  text: '#1A1208',
  textSecondary: '#6B5E50',
  textMuted: '#A89A8A',
  cardBg: '#fff',
  inputBg: '#FAF7F2',
  divider: '#F0ECE6',
  success: '#3DBE7A',
  amber: '#EF9F27',
};

const DARK: ThemeColors = {
  primary: '#E8593C',
  background: '#121212',
  surface: '#1E1E1E',
  surfaceBorder: '#2C2C2C',
  text: '#F5F0EA',
  textSecondary: '#B0A89E',
  textMuted: '#7A7268',
  cardBg: '#1E1E1E',
  inputBg: '#252525',
  divider: '#2C2C2C',
  success: '#3DBE7A',
  amber: '#EF9F27',
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
