import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { colors } from '@/constants/theme';
import { fonts } from '@/lib/fonts';
import { supabase } from '@/lib/supabase';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const value = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(value)) {
      setError('Geçerli bir e-posta adresi gir.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(value, {
      redirectTo: Linking.createURL('reset-password'),
    });
    setLoading(false);
    // Hesabın var olup olmadığını belli etmemek için yalnızca bağlantı sorunlarında hata gösterilir.
    if (err && !err.status) {
      setError('Bağlantı kurulamadı. Tekrar dene.');
      return;
    }
    if (err?.status === 429) {
      setError('Çok fazla deneme yaptın. Biraz sonra tekrar dene.');
      return;
    }
    setSent(true);
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.wrap}>
          <Pressable style={s.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Geri">
            <Ionicons name="chevron-back" size={20} color="#151A16" />
          </Pressable>

          {sent ? (
            <>
              <Ionicons name="mail-outline" size={44} color={colors.secondary} />
              <Text style={s.title}>E-postanı kontrol et</Text>
              <Text style={s.sub}>
                {email.trim()} adresi kayıtlıysa şifre yenileme bağlantısı gönderdik. Gelmediyse istenmeyen kutusuna bak.
              </Text>
              <Pressable style={s.btn} onPress={() => router.replace('/(auth)/login' as any)} accessibilityRole="button">
                <Text style={s.btnText}>Girişe dön</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.title}>Şifreni mi unuttun?</Text>
              <Text style={s.sub}>E-postanı yaz, yenileme bağlantısını gönderelim.</Text>
              <Text style={s.label}>E-posta</Text>
              <TextInput
                style={s.input}
                value={email}
                onChangeText={(t) => { setEmail(t); setError(null); }}
                placeholder="ornek@email.com"
                placeholderTextColor="#6B766F"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
              />
              {error ? <Text style={s.error}>{error}</Text> : null}
              <Pressable style={[s.btn, loading && s.btnDisabled]} onPress={submit} disabled={loading} accessibilityRole="button">
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Bağlantı gönder</Text>}
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
  wrap: { flex: 1, paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  back: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: '#E3E6DE', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 28, lineHeight: 33, fontFamily: fonts.display, letterSpacing: -0.6, color: '#17402F', marginTop: 4 },
  sub: { fontSize: 15, lineHeight: 22, fontFamily: fonts.regular, color: '#56605A', marginBottom: 12 },
  label: { fontSize: 12, fontFamily: fonts.semibold, color: '#56605A', marginTop: 4 },
  input: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: '#E3E6DE', backgroundColor: '#fff', paddingHorizontal: 16, fontSize: 15, fontFamily: fonts.regular, color: '#151A16' },
  error: { fontSize: 13, fontFamily: fonts.medium, color: '#C62828' },
  btn: { height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: 15, fontFamily: fonts.bold, color: '#fff' },
});
