import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[afiyetli] EXPO_PUBLIC_SUPABASE_URL veya EXPO_PUBLIC_SUPABASE_ANON_KEY tanımlı değil. .env dosyasını kontrol edin.',
  );
}

let pageClosing = false;

/** Web: sayfa kapanırken başlayan istekleri tarayıcı iptal eder, keepalive ile tamamlanırlar. */
export function setPageClosing(closing: boolean): void {
  pageClosing = closing;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: (input, init) => fetch(input, pageClosing ? { ...init, keepalive: true } : init),
  },
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
