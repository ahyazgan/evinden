import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Link, useRouter } from 'expo-router';

import { AuthDivider, AuthError, AuthPasswordField, AuthShell, AuthSocialButtons } from '@/components/shared/AuthGate';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/lib/auth-context';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';

export default function LoginScreen() {
  const { colors: t } = useTheme();
  const { signInWithEmail, signInWithGoogle, signInWithApple } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email.trim()) {
      setError('Lütfen e-posta adresini gir.');
      return;
    }
    if (!password) {
      setError('Şifreni gir.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await signInWithEmail(email.trim(), password);
    setLoading(false);
    if (err) {
      if (err.includes('Invalid login')) {
        setError('E-posta veya şifre hatalı.');
      } else {
        setError(err);
      }
    } else {
      router.replace('/(customer)' as any);
    }
  };

  const handleGoogle = async () => {
    setSocialLoading('google');
    setError(null);
    const { error: err } = await signInWithGoogle();
    setSocialLoading(null);
    if (err && !err.includes('iptal')) {
      setError(err);
    }
  };

  const handleApple = async () => {
    setSocialLoading('apple');
    setError(null);
    const { error: err } = await signInWithApple();
    setSocialLoading(null);
    if (err && !err.includes('iptal')) {
      setError(err);
    }
  };

  const isLoading = loading || !!socialLoading;

  return (
    <AuthShell title="Tekrar hoş geldin" subtitle="Sofran seni bekliyor.">
      <AuthSocialButtons onGoogle={handleGoogle} onApple={handleApple} busy={socialLoading} disabled={isLoading} />
      <AuthDivider />

      <Input
        label="E-posta"
        accessibilityLabel="E-posta"
        value={email}
        onChangeText={(v) => { setEmail(v); setError(null); }}
        placeholder="ornek@email.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        editable={!isLoading}
      />

      <AuthPasswordField
        label="Şifre"
        visible={showPassword}
        onToggle={() => setShowPassword(!showPassword)}
        value={password}
        onChangeText={(v) => { setPassword(v); setError(null); }}
        placeholder="Şifren"
        editable={!isLoading}
      />

      <Pressable
        style={s.forgot}
        onPress={() => router.push({ pathname: '/(auth)/forgot-password', params: { email: email.trim() } } as any)}
        accessibilityRole="button"
      >
        <Text style={[s.forgotText, { color: t.text }]}>Şifremi unuttum</Text>
      </Pressable>

      {error ? <AuthError message={error} /> : null}

      <Button label="Giriş yap" onPress={handleLogin} loading={loading} disabled={isLoading} size="lg" fullWidth />

      <Link href="/(auth)/register" asChild>
        <Pressable style={s.switchRow} accessibilityRole="link">
          <Text style={[s.switchText, { color: t.textSecondary }]}>
            Hesabın yok mu? <Text style={[s.switchStrong, { color: t.text }]}>Kayıt ol</Text>
          </Text>
        </Pressable>
      </Link>
    </AuthShell>
  );
}

const s = StyleSheet.create({
  forgot: { alignSelf: 'flex-end', minHeight: 44, marginTop: -10, justifyContent: 'center' },
  forgotText: { fontSize: 13, fontFamily: fonts.bold },
  switchRow: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  switchText: { fontSize: 14, fontFamily: fonts.regular },
  switchStrong: { fontFamily: fonts.bold },
});
