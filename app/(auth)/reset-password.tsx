import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { colors } from '@/constants/theme';
import { fonts } from '@/lib/fonts';
import { supabase } from '@/lib/supabase';

/** E-postadaki bağlantıdan gelen oturum bilgilerini okur (adresin # sonrasında olur). */
function tokensFromUrl(url: string | null): { access_token: string; refresh_token: string } | null {
  if (!url) return null;
  const hash = url.split('#')[1];
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  return access_token && refresh_token ? { access_token, refresh_token } : null;
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const url = Linking.useURL();
  const [ready, setReady] = useState<'checking' | 'ok' | 'invalid'>('checking');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tokens = tokensFromUrl(url ?? (await Linking.getInitialURL()));
      if (tokens) {
        const { error: err } = await supabase.auth.setSession(tokens);
        if (!cancelled) setReady(err ? 'invalid' : 'ok');
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setReady(data.session ? 'ok' : 'invalid');
    })();
    return () => { cancelled = true; };
  }, [url]);

  const submit = async () => {
    if (password.length < 6) {
      setError('Şifre en az 6 karakter olmalı.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) {
      setError('Şifre değiştirilemedi. Bağlantının süresi dolmuş olabilir.');
      return;
    }
    setDone(true);
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.wrap}>
          {ready === 'checking' ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : ready === 'invalid' ? (
            <>
              <Text style={s.title}>Bağlantı geçersiz</Text>
              <Text style={s.sub}>Bağlantının süresi dolmuş olabilir. Yeni bir bağlantı iste.</Text>
              <Pressable style={s.btn} onPress={() => router.replace('/(auth)/forgot-password' as any)} accessibilityRole="button">
                <Text style={s.btnText}>Yeni bağlantı iste</Text>
              </Pressable>
            </>
          ) : done ? (
            <>
              <Text style={s.title}>Şifren değişti</Text>
              <Text style={s.sub}>Artık yeni şifrenle giriş yapabilirsin.</Text>
              <Pressable style={s.btn} onPress={() => router.replace('/(customer)' as any)} accessibilityRole="button">
                <Text style={s.btnText}>Devam et</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.title}>Yeni şifreni belirle</Text>
              <Text style={s.sub}>En az 6 karakter olsun.</Text>
              <TextInput
                style={s.input}
                value={password}
                onChangeText={(t) => { setPassword(t); setError(null); }}
                placeholder="Yeni şifre"
                placeholderTextColor="#6B766F"
                secureTextEntry
                autoCapitalize="none"
                editable={!loading}
                accessibilityLabel="Yeni şifre"
              />
              {error ? <Text style={s.error}>{error}</Text> : null}
              <Pressable style={[s.btn, loading && s.btnDisabled]} onPress={submit} disabled={loading} accessibilityRole="button">
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Şifreyi kaydet</Text>}
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF8F2' },
  flex: { flex: 1 },
  wrap: { flex: 1, paddingHorizontal: 20, paddingTop: 48, gap: 8 },
  title: { fontSize: 28, lineHeight: 33, fontFamily: fonts.display, letterSpacing: -0.6, color: '#17402F' },
  sub: { fontSize: 15, lineHeight: 22, fontFamily: fonts.regular, color: '#56605A', marginBottom: 12 },
  input: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: '#E3E6DE', backgroundColor: '#fff', paddingHorizontal: 16, fontSize: 15, fontFamily: fonts.regular, color: '#151A16' },
  error: { fontSize: 13, fontFamily: fonts.medium, color: '#C62828' },
  btn: { height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: 15, fontFamily: fonts.bold, color: '#fff' },
});
