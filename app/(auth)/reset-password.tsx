import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';

import { AuthError, AuthLead, AuthShell } from '@/components/shared/AuthGate';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { supabase } from '@/lib/supabase';
import { takePendingRecoveryUrl } from '@/lib/recovery-link';
import { recoveryTokensFromUrl } from '@/lib/recovery-tokens';
import { useTheme } from '@/lib/theme-context';

export default function ResetPasswordScreen() {
  const { colors: t } = useTheme();
  const router = useRouter();
  const url = Linking.useLinkingURL();
  const [ready, setReady] = useState<'checking' | 'ok' | 'invalid'>('checking');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Yalnızca bağlantıdan gelen oturum kabul edilir: açık başka bir hesabın şifresi değişmesin.
      const tokens = recoveryTokensFromUrl(takePendingRecoveryUrl())
        ?? recoveryTokensFromUrl(url)
        ?? recoveryTokensFromUrl(await Linking.getInitialURL());
      if (!tokens) {
        if (!cancelled) setReady(prev => (prev === 'ok' ? prev : 'invalid'));
        return;
      }
      const { error: err } = await supabase.auth.setSession(tokens);
      if (!cancelled) setReady(err ? 'invalid' : 'ok');
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

  const title =
    ready === 'checking' ? 'Bir saniye'
      : ready === 'invalid' ? 'Bağlantı geçersiz'
        : done ? 'Şifren değişti'
          : 'Yeni şifreni belirle';

  return (
    <AuthShell title={title} titleSize={30}>
      {ready === 'checking' ? (
        <View style={s.checking} accessible accessibilityLabel="Bağlantı kontrol ediliyor">
          <ActivityIndicator size="large" color={t.primary} />
        </View>
      ) : ready === 'invalid' ? (
        <>
          <AuthLead>Bağlantının süresi dolmuş olabilir. Yeni bir bağlantı iste.</AuthLead>
          <Button label="Yeni bağlantı iste" onPress={() => router.replace('/(auth)/forgot-password' as any)} size="lg" fullWidth />
        </>
      ) : done ? (
        <>
          <AuthLead>Artık yeni şifrenle giriş yapabilirsin.</AuthLead>
          <Button label="Devam et" onPress={() => router.replace('/(customer)' as any)} size="lg" fullWidth />
        </>
      ) : (
        <>
          <AuthLead>En az 6 karakter olsun.</AuthLead>
          <Input
            label="Yeni şifre"
            accessibilityLabel="Yeni şifre"
            value={password}
            onChangeText={(v) => { setPassword(v); setError(null); }}
            placeholder="En az 6 karakter"
            secureTextEntry
            autoCapitalize="none"
            editable={!loading}
          />
          {error ? <AuthError message={error} /> : null}
          <Button label="Şifreyi kaydet" onPress={submit} loading={loading} size="lg" fullWidth />
        </>
      )}
    </AuthShell>
  );
}

const s = StyleSheet.create({
  checking: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
});
