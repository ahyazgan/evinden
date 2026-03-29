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

import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { formatLocalDisplay, toTurkeyE164 } from '@/lib/phone';

type Step = 'phone' | 'otp';

const DEMO_OTP = '123456';

export default function LoginScreen() {
  const { demoLogin } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [localDigits, setLocalDigits] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChangePhone = (text: string) => {
    const d = text.replace(/\D/g, '').slice(0, 10);
    setLocalDigits(d);
    setError(null);
  };

  const sendOtp = async () => {
    const phone = toTurkeyE164(localDigits);
    if (!phone) {
      setError('Lütfen geçerli bir Türkiye cep telefonu girin (10 hane, 5 ile başlamalı).');
      return;
    }
    // Demo: skip actual SMS, go straight to OTP step
    setStep('otp');
    setOtp('');
    setError(null);
  };

  const verify = async () => {
    if (otp.length !== 6) {
      setError('Lütfen 6 haneli doğrulama kodunu girin.');
      return;
    }
    if (otp !== DEMO_OTP) {
      setError('Doğrulama kodu hatalı. Demo kod: 123456');
      return;
    }

    setLoading(true);
    setError(null);
    const phone = toTurkeyE164(localDigits)!;
    const ok = await demoLogin(phone);
    setLoading(false);

    if (!ok) {
      setError('Bu numara ile kayıtlı hesap bulunamadı. Önce kayıt olun.');
    } else {
      router.replace('/(customer)/profile' as any);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo */}
          <View style={styles.logoWrap}>
            <Text style={styles.logoEmoji}>🍽️</Text>
            <Text style={styles.logoText}>evinden</Text>
          </View>

          <Text style={styles.title}>Giriş Yap</Text>
          <Text style={styles.subtitle}>
            {step === 'phone'
              ? 'Telefon numaranızla giriş yapın'
              : 'Demo doğrulama kodu: 123456'}
          </Text>

          {step === 'phone' ? (
            <>
              <Text style={styles.label}>Cep telefonu</Text>
              <View style={styles.phoneRow}>
                <View style={styles.prefixBox}>
                  <Text style={styles.prefixText}>+90</Text>
                </View>
                <TextInput
                  style={styles.phoneInput}
                  value={formatLocalDisplay(localDigits)}
                  onChangeText={onChangePhone}
                  placeholder="5xx xxx xx xx"
                  placeholderTextColor="#B8AFA4"
                  keyboardType="phone-pad"
                  editable={!loading}
                  autoComplete="tel"
                />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>Doğrulama kodu</Text>
              <TextInput
                style={styles.otpInput}
                value={otp}
                onChangeText={(t) => {
                  setOtp(t.replace(/\D/g, '').slice(0, 6));
                  setError(null);
                }}
                placeholder="123456"
                placeholderTextColor="#B8AFA4"
                keyboardType="number-pad"
                maxLength={6}
                editable={!loading}
              />
              <View style={styles.demoHint}>
                <Text style={styles.demoHintText}>💡 Demo mod: Kodu 123456 olarak girin</Text>
              </View>
              <Pressable onPress={() => setStep('phone')} disabled={loading} style={styles.linkBtn}>
                <Text style={styles.linkMuted}>← Numarayı değiştir</Text>
              </Pressable>
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.primaryBtn, loading && styles.btnDisabled]}
            onPress={step === 'phone' ? sendOtp : verify}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>{step === 'phone' ? 'Devam Et' : 'Giriş Yap'}</Text>
            )}
          </Pressable>

          <View style={styles.footerRow}>
            <Text style={styles.muted}>Hesabınız yok mu? </Text>
            <Link href="/(auth)/register" asChild>
              <Pressable>
                <Text style={styles.link}>Kayıt ol</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 48,
  },
  logoWrap: { alignItems: 'center', marginBottom: 32 },
  logoEmoji: { fontSize: 56 },
  logoText: { fontSize: 28, fontWeight: '900', color: '#1A1208', marginTop: 8, letterSpacing: -0.5 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1A1208',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#8A7E72',
    marginBottom: 28,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B5E50',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  prefixBox: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#EDE8E2',
  },
  prefixText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A1208',
  },
  phoneInput: {
    flex: 1,
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#EDE8E2',
    color: '#1A1208',
    fontWeight: '600',
  },
  otpInput: {
    fontSize: 28,
    letterSpacing: 10,
    textAlign: 'center',
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#EDE8E2',
    color: '#1A1208',
    fontWeight: '700',
  },
  demoHint: {
    backgroundColor: '#FFF8E1',
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
    alignItems: 'center',
  },
  demoHintText: { fontSize: 12, color: '#F57F17', fontWeight: '600' },
  error: {
    color: '#C62828',
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: '#FFEBEE',
    padding: 10,
    borderRadius: 10,
  },
  primaryBtn: {
    marginTop: 24,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  btnDisabled: { opacity: 0.7 },
  primaryBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  linkBtn: { marginTop: 16, alignSelf: 'center' },
  linkMuted: { color: '#8A7E72', fontSize: 14, fontWeight: '500' },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 32,
    flexWrap: 'wrap',
  },
  muted: { color: '#8A7E72', fontSize: 15 },
  link: { color: colors.primary, fontSize: 15, fontWeight: '700' },
});
