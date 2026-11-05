import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { AuthDivider, AuthError, AuthPasswordField, AuthShell, AuthSocialButtons } from '@/components/shared/AuthGate';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/lib/auth-context';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';

type Step = 'info' | 'password';

export default function RegisterScreen() {
  const { colors: t } = useTheme();
  const { signUpWithEmail, signInWithGoogle, signInWithApple } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>('info');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const CONSENT_ERROR = 'Devam etmek için koşulları kabul et.';

  const goToPassword = () => {
    if (name.trim().length < 2) {
      setError('Lütfen adını gir (en az 2 karakter).');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Lütfen geçerli bir e-posta adresi gir.');
      return;
    }
    if (!accepted) {
      setError(CONSENT_ERROR);
      return;
    }
    setError(null);
    setStep('password');
  };

  const createAccount = async () => {
    if (password.length < 6) {
      setError('Şifre en az 6 karakter olmalı.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await signUpWithEmail(email.trim(), password, name.trim(), marketing);
    setLoading(false);
    if (err) {
      if (err.includes('already registered')) {
        setError('Bu e-posta zaten kayıtlı. Giriş yap.');
      } else {
        setError(err);
      }
    } else {
      router.replace('/(customer)' as any);
    }
  };

  const handleGoogle = async () => {
    if (!accepted) {
      setError(CONSENT_ERROR);
      return;
    }
    setSocialLoading('google');
    setError(null);
    const { error: err } = await signInWithGoogle();
    setSocialLoading(null);
    if (err && !err.includes('iptal')) setError(err);
  };

  const handleApple = async () => {
    if (!accepted) {
      setError(CONSENT_ERROR);
      return;
    }
    setSocialLoading('apple');
    setError(null);
    const { error: err } = await signInWithApple();
    setSocialLoading(null);
    if (err && !err.includes('iptal')) setError(err);
  };

  const isLoading = loading || !!socialLoading;
  const passwordOk = password.length >= 6;

  return (
    <AuthShell
      title={step === 'info' ? 'Sofraya katıl' : 'Şifre belirle'}
      subtitle={step === 'info' ? 'Hesabını bir dakikada aç.' : `${email} için bir şifre oluştur`}
      logo
      onBack={() => {
        if (step === 'password') setStep('info');
        else router.back();
      }}
    >
      <View style={s.progressRow} accessible accessibilityLabel={`Adım ${step === 'info' ? 1 : 2} / 2`}>
        <View style={[s.progressDot, { backgroundColor: t.primary }]} />
        <View style={[s.progressDot, { backgroundColor: step === 'password' ? t.primary : t.divider }]} />
      </View>

      {step === 'info' ? (
        <>
          <AuthSocialButtons onGoogle={handleGoogle} onApple={handleApple} busy={socialLoading} disabled={isLoading} />
          <AuthDivider />

          <Input
            label="Ad soyad"
            accessibilityLabel="Ad soyad"
            value={name}
            onChangeText={v => { setName(v); setError(null); }}
            placeholder="Adın soyadın"
            autoCapitalize="words"
            editable={!isLoading}
            autoFocus
          />

          <Input
            label="E-posta"
            accessibilityLabel="E-posta"
            value={email}
            onChangeText={v => { setEmail(v); setError(null); }}
            placeholder="ornek@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            editable={!isLoading}
          />

          <View style={s.consent}>
            <Pressable
              style={s.consentBox}
              onPress={() => { setAccepted(!accepted); setError(null); }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: accepted }}
              accessibilityLabel="Kullanım koşullarını ve gizlilik politikasını kabul ediyorum"
            >
              <View style={[s.check, { borderColor: accepted ? t.primary : t.surfaceBorder, backgroundColor: accepted ? t.primary : t.surface }]}>
                {accepted ? <Ionicons name="checkmark" size={14} color={t.onBrand} /> : null}
              </View>
            </Pressable>
            <Text style={[s.consentText, { color: t.textSecondary }]}>
              <Text style={[s.consentLink, { color: t.text }]} onPress={() => router.push('/(customer)/terms' as any)} accessibilityRole="link">Kullanım koşullarını</Text>
              {' ve '}
              <Text style={[s.consentLink, { color: t.text }]} onPress={() => router.push('/(customer)/privacy' as any)} accessibilityRole="link">gizlilik politikasını</Text>
              {' kabul ediyorum.'}
            </Text>
          </View>

          <Pressable
            style={s.consent}
            onPress={() => setMarketing(!marketing)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: marketing }}
            accessibilityLabel="Kampanya ve indirim bildirimleri almak istiyorum."
          >
            <View style={s.consentBox}>
              <View style={[s.check, { borderColor: marketing ? t.primary : t.surfaceBorder, backgroundColor: marketing ? t.primary : t.surface }]}>
                {marketing ? <Ionicons name="checkmark" size={14} color={t.onBrand} /> : null}
              </View>
            </View>
            <Text style={[s.consentText, { color: t.textSecondary }]}>Kampanya ve indirim bildirimleri almak istiyorum.</Text>
          </Pressable>
        </>
      ) : (
        <>
          <AuthPasswordField
            label="Şifre"
            visible={showPassword}
            onToggle={() => setShowPassword(!showPassword)}
            value={password}
            onChangeText={v => { setPassword(v); setError(null); }}
            placeholder="En az 6 karakter"
            editable={!isLoading}
            autoFocus
          />

          <View style={s.hintRow}>
            <Ionicons
              name={passwordOk ? 'checkmark-circle' : 'ellipse-outline'}
              size={16}
              color={passwordOk ? t.success : t.textMuted}
            />
            <Text style={[s.hintText, { color: passwordOk ? t.success : t.textSecondary }]}>En az 6 karakter</Text>
          </View>
        </>
      )}

      {error ? <AuthError message={error} /> : null}

      <Button
        label={step === 'password' ? 'Hesap oluştur' : 'Devam et'}
        onPress={step === 'info' ? goToPassword : createAccount}
        loading={loading}
        disabled={isLoading}
        size="lg"
        fullWidth
      />

      <Link href="/(auth)/login" asChild>
        <Pressable style={s.switchRow} accessibilityRole="link">
          <Text style={[s.switchText, { color: t.textSecondary }]}>
            Zaten hesabın var mı? <Text style={[s.switchStrong, { color: t.text }]}>Giriş yap</Text>
          </Text>
        </Pressable>
      </Link>
    </AuthShell>
  );
}

const s = StyleSheet.create({
  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  progressDot: { width: 32, height: 4, borderRadius: 2 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  consentBox: { width: 44, height: 44, marginLeft: -12, alignItems: 'center', justifyContent: 'center' },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  consentText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: fonts.regular },
  consentLink: { fontFamily: fonts.semibold, textDecorationLine: 'underline' },
  hintText: { fontSize: 13, fontFamily: fonts.medium },
  switchRow: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  switchText: { fontSize: 14, fontFamily: fonts.regular },
  switchStrong: { fontFamily: fonts.bold },
});
