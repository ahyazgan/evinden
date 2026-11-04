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
import { fonts } from '@/lib/fonts';
import { Logo } from '@/components/shared/Logo';

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
      setError('Lütfen adını gir (en az 2 karakter).');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Lütfen geçerli bir e-posta adresi gir.');
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
    const { error: err } = await signUpWithEmail(email.trim(), password, name.trim());
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
            <Ionicons name="chevron-back" size={20} color="#151A16" />
          </Pressable>

          {/* Logo */}
          <View style={s.logoWrap}>
            <Logo size={52} />
          </View>

          {/* Progress indicator */}
          <View style={s.progressRow}>
            <View style={[s.progressDot, s.progressDotActive]} />
            <View style={[s.progressDot, step === 'password' && s.progressDotActive]} />
          </View>

          {step === 'info' ? (
            <>
              <Text style={s.title}>Hesap Oluştur</Text>
              <Text style={s.subtitle}>Bilgilerini gir</Text>

              {/* Social Login */}
              <View style={s.socialRow}>
                <Pressable
                  style={[s.socialBtn, s.googleBtn]}
                  onPress={handleGoogle}
                  disabled={isLoading}
                >
                  {socialLoading === 'google' ? (
                    <ActivityIndicator size="small" color="#151A16" />
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
                placeholder="Adın Soyadın"
                placeholderTextColor="#A3ACA5"
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
                placeholderTextColor="#A3ACA5"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                editable={!isLoading}
              />
            </>
          ) : (
            <>
              <Text style={s.title}>Şifre belirle</Text>
              <Text style={s.subtitle}>{email} için bir şifre oluştur</Text>

              <Text style={s.label}>Şifre</Text>
              <View style={s.passwordRow}>
                <TextInput
                  style={s.passwordInput}
                  value={password}
                  onChangeText={t => { setPassword(t); setError(null); }}
                  placeholder="En az 6 karakter"
                  placeholderTextColor="#A3ACA5"
                  secureTextEntry={!showPassword}
                  editable={!isLoading}
                  autoFocus
                />
                <Pressable style={s.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#6B766F" />
                </Pressable>
              </View>

              {/* Password strength hints */}
              <View style={s.hintBox}>
                <View style={s.hintRow}>
                  <Ionicons
                    name={password.length >= 6 ? 'checkmark-circle' : 'ellipse-outline'}
                    size={16}
                    color={password.length >= 6 ? '#2E7D32' : '#A3ACA5'}
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
                {step === 'password' ? 'Hesap Oluştur' : 'Devam Et'}
              </Text>
            )}
          </Pressable>

          <View style={s.footerRow}>
            <Text style={s.muted}>Zaten hesabın var mı? </Text>
            <Link href="/(auth)/login" asChild>
              <Pressable>
                <Text style={s.link}>Giriş yap</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF8F2' },
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
    backgroundColor: '#EFF2EA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  backBtnText: { fontSize: 24, fontFamily: fonts.display, color: '#151A16', marginTop: -2 },

  logoWrap: { alignItems: 'center', marginBottom: 24 },

  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 32 },
  progressDot: { width: 32, height: 4, borderRadius: 2, backgroundColor: '#E3E6DE' },
  progressDotActive: { backgroundColor: colors.primary },

  title: { fontSize: 24, fontFamily: fonts.display, color: '#151A16', marginBottom: 6 },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, color: '#6B766F', marginBottom: 24, lineHeight: 20 },

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
  googleBtn: { backgroundColor: '#fff', borderColor: '#E3E6DE' },
  appleBtn: { backgroundColor: '#000', borderColor: '#151A16' },
  socialBtnText: { fontSize: 15, fontFamily: fonts.bold, color: '#151A16' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E3E6DE' },
  dividerText: { marginHorizontal: 12, fontSize: 12, color: '#6B766F', fontFamily: fonts.semibold },

  label: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: '#56605A',
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
    borderColor: '#E3E6DE',
    color: '#151A16',
    fontFamily: fonts.semibold,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E3E6DE',
  },
  passwordInput: {
    flex: 1,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#151A16',
    fontFamily: fonts.semibold,
  },
  eyeBtn: { paddingHorizontal: 14 },

  hintBox: { marginTop: 12, gap: 6 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hintText: { fontSize: 13, color: '#A3ACA5', fontFamily: fonts.medium },
  hintTextOk: { color: '#2E7D32' },

  error: {
    color: '#C62828',
    marginTop: 14,
    fontSize: 13,
    fontFamily: fonts.semibold,
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
  primaryBtnText: { color: '#fff', fontSize: 16, fontFamily: fonts.bold },

  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 28,
  },
  muted: { color: '#6B766F', fontFamily: fonts.regular, fontSize: 14 },
  link: { color: colors.primary, fontSize: 14, fontFamily: fonts.bold },
});
