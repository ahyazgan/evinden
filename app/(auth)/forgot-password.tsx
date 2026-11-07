import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';

import { AuthError, AuthLead, AuthShell } from '@/components/shared/AuthGate';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { fonts } from '@/lib/fonts';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme-context';

export default function ForgotPasswordScreen() {
  const { colors: t } = useTheme();
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

  const spamNote = (
    <View style={[s.note, { backgroundColor: t.background }]}>
      <Ionicons name="mail-outline" size={20} color={t.text} />
      <Text style={[s.noteText, { color: t.text }]}>Gelmediyse istenmeyen kutusuna bak.</Text>
    </View>
  );

  return (
    <AuthShell
      title={sent ? 'E-postanı kontrol et' : 'Şifreni mi unuttun?'}
      titleSize={30}
      onBack={() => router.back()}
      logo
    >
      {sent ? (
        <>
          <AuthLead>{email.trim()} adresi kayıtlıysa şifre yenileme bağlantısı gönderdik.</AuthLead>
          {spamNote}
          <Button label="Girişe dön" onPress={() => router.replace('/(auth)/login' as any)} size="lg" fullWidth />
        </>
      ) : (
        <>
          <AuthLead>E-postanı yaz, yenileme bağlantısını gönderelim.</AuthLead>
          <Input
            label="E-posta"
            accessibilityLabel="E-posta"
            value={email}
            onChangeText={(v) => { setEmail(v); setError(null); }}
            placeholder="ornek@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />
          {error ? <AuthError message={error} /> : null}
          <Button label="Bağlantı gönder" onPress={submit} loading={loading} size="lg" fullWidth />
          {spamNote}
        </>
      )}
    </AuthShell>
  );
}

const s = StyleSheet.create({
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 12 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: fonts.regular },
});
