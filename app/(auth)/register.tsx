import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

type Step = 'info' | 'password';

export default function RegisterScreen() {
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

  const goToPassword = () => {
    if (name.trim().length < 2) {
      setError('Lutfen adinizi girin (en az 2 karakter).');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Lutfen gecerli bir e-posta adresi girin.');
      return;
    }
    setError(null);
    setStep('password');
  };

  const createAccount = async () => {
    if (password.length < 6) {
      setError('Sifre en az 6 karakter olmalidir.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await signUpWithEmail(email.trim(), password, name.trim());
    setLoading(false);
    if (err) {
      if (err.includes('already registered')) {
        setError('Bu e-posta adresi zaten kayitli. Giris yapin.');
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
    if (err && !err.includes('iptal')) setError(err);
  };

  const handleApple = async () => {
    setSocialLoading('apple');
    setError(null);
    const { error: err } = await signInWithApple();
    setSocialLoading(null);
    if (err && !err.includes('iptal')) setError(err);
  };

  const isLoading = loading || !!socialLoading;

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.flex}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back button */}
          <Pressable
            style={s.backBtn}
            onPress={() => {
              if (step === 'password') setStep('info');
              else router.back();
            }}
          >
            <Text style={s.backBtnText}>‹</Text>
          </Pressable>

          {/* Logo */}
          <View style={s.logoWrap}>
            <Text style={s.logoText}>evinden</Text>
          </View>

          {/* Progress indicator */}
          <View style={s.progressRow}>
            <View style={[s.progressDot, s.progressDotActive]} />
            <View style={[s.progressDot, step === 'password' && s.progressDotActive]} />
          </View>

          {step === 'info' ? (
            <>
              <Text style={s.title}>Hesap Olustur</Text>
              <Text style={s.subtitle}>Bilgilerinizi girin</Text>

              {/* Social Login */}
              <View style={s.socialRow}>
                <Pressable
                  style={[s.socialBtn, s.googleBtn]}
                  onPress={handleGoogle}
                  disabled={isLoading}
                >
                  {socialLoading === 'google' ? (
                    <ActivityIndicator size="small" color="#1A1208" />
                  ) : (
                    <>
                      <Ionicons name="logo-google" size={20} color="#DB4437" />
                      <Text style={s.socialBtnText}>Google</Text>
                    </>
                  )}
                </Pressable>

                <Pressable
                  style={[s.socialBtn, s.appleBtn]}
                  onPress={handleApple}
                  disabled={isLoading}
                >
                  {socialLoading === 'apple' ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="logo-apple" size={20} color="#fff" />
                      <Text style={[s.socialBtnText, { color: '#fff' }]}>Apple</Text>
                    </>
                  )}
                </Pressable>
              </View>

              {/* Divider */}
              <View style={s.dividerRow}>
                <View style={s.dividerLine} />
                <Text style={s.dividerText}>veya e-posta ile</Text>
                <View style={s.dividerLine} />
              </View>

              {/* Name */}
              <Text style={s.label}>Ad Soyad</Text>
              <TextInput
                style={s.input}
                value={name}
                onChangeText={t => { setName(t); setError(null); }}
                placeholder="Adiniz Soyadiniz"
                placeholderTextColor="#C4B8AA"
                autoCapitalize="words"
                editable={!isLoading}
                autoFocus
              />

              {/* Email */}
              <Text style={[s.label, { marginTop: 16 }]}>E-posta</Text>
              <TextInput
                style={s.input}
                value={email}
                onChangeText={t => { setEmail(t); setError(null); }}
                placeholder="ornek@email.com"
                placeholderTextColor="#C4B8AA"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                editable={!isLoading}
              />
            </>
          ) : (
            <>
              <Text style={s.title}>Sifre Belirle</Text>
              <Text style={s.subtitle}>{email} icin bir sifre olusturun</Text>

              <Text style={s.label}>Sifre</Text>
              <View style={s.passwordRow}>
                <TextInput
                  style={s.passwordInput}
                  value={password}
                  onChangeText={t => { setPassword(t); setError(null); }}
                  placeholder="En az 6 karakter"
                  placeholderTextColor="#C4B8AA"
                  secureTextEntry={!showPassword}
                  editable={!isLoading}
                  autoFocus
                />
                <Pressable style={s.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#A89A8A" />
                </Pressable>
              </View>

              {/* Password strength hints */}
              <View style={s.hintBox}>
                <View style={s.hintRow}>
                  <Ionicons
                    name={password.length >= 6 ? 'checkmark-circle' : 'ellipse-outline'}
                    size={16}
                    color={password.length >= 6 ? '#3DBE7A' : '#C4B8AA'}
                  />
                  <Text style={[s.hintText, password.length >= 6 && s.hintTextOk]}>En az 6 karakter</Text>
                </View>
              </View>
            </>
          )}

          {error ? <Text style={s.error}>{error}</Text> : null}

          <Pressable
            style={[s.primaryBtn, isLoading && s.btnDisabled]}
            onPress={step === 'info' ? goToPassword : createAccount}
            disabled={isLoading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.primaryBtnText}>
                {step === 'password' ? 'Hesap Olustur' : 'Devam Et'}
              </Text>
            )}
          </Pressable>

          <View style={s.footerRow}>
            <Text style={s.muted}>Zaten hesabiniz var mi? </Text>
            <Link href="/(auth)/login" asChild>
              <Pressable>
                <Text style={s.link}>Giris yap</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 48,
  },

  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F5F0EA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  backBtnText: { fontSize: 24, fontWeight: '700', color: '#1A1208', marginTop: -2 },

  logoWrap: { alignItems: 'center', marginBottom: 24 },
  logoText: { fontSize: 26, fontWeight: '900', color: colors.primary, letterSpacing: -0.5 },

  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 32 },
  progressDot: { width: 32, height: 4, borderRadius: 2, backgroundColor: '#EDE8E2' },
  progressDotActive: { backgroundColor: colors.primary },

  title: { fontSize: 24, fontWeight: '800', color: '#1A1208', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#A89A8A', marginBottom: 24, lineHeight: 20 },

  /* Social */
  socialRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  socialBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  googleBtn: { backgroundColor: '#fff', borderColor: '#EDE8E2' },
  appleBtn: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  socialBtnText: { fontSize: 15, fontWeight: '700', color: '#1A1208' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#EDE8E2' },
  dividerText: { marginHorizontal: 12, fontSize: 12, color: '#A89A8A', fontWeight: '600' },

  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B5E50',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#EDE8E2',
    color: '#1A1208',
    fontWeight: '600',
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#EDE8E2',
  },
  passwordInput: {
    flex: 1,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#1A1208',
    fontWeight: '600',
  },
  eyeBtn: { paddingHorizontal: 14 },

  hintBox: { marginTop: 12, gap: 6 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hintText: { fontSize: 13, color: '#C4B8AA', fontWeight: '500' },
  hintTextOk: { color: '#3DBE7A' },

  error: {
    color: '#C62828',
    marginTop: 14,
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: '#FFEBEE',
    padding: 12,
    borderRadius: 12,
  },

  primaryBtn: {
    marginTop: 28,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  btnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 28,
  },
  muted: { color: '#A89A8A', fontSize: 14 },
  link: { color: colors.primary, fontSize: 14, fontWeight: '700' },
});
