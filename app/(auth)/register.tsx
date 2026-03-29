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

type Step = 'phone' | 'otp' | 'name';

const DEMO_OTP = '123456';

export default function RegisterScreen() {
  const { demoRegister } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [localDigits, setLocalDigits] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChangePhone = (text: string) => {
    setLocalDigits(text.replace(/\D/g, '').slice(0, 10));
    setError(null);
  };

  const sendOtp = () => {
    const phone = toTurkeyE164(localDigits);
    if (!phone) {
      setError('Lütfen geçerli bir Türkiye cep telefonu girin (10 hane, 5 ile başlamalı).');
      return;
    }
    setStep('otp');
    setOtp('');
    setError(null);
  };

  const verifyOtp = () => {
    if (otp.length !== 6) {
      setError('Lütfen 6 haneli doğrulama kodunu girin.');
      return;
    }
    if (otp !== DEMO_OTP) {
      setError('Doğrulama kodu hatalı. Demo kod: 123456');
      return;
    }
    setStep('name');
    setError(null);
  };

  const createAccount = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Lütfen adınızı ve soyadınızı girin.');
      return;
    }
    setLoading(true);
    setError(null);
    const phone = toTurkeyE164(localDigits)!;
    await demoRegister(trimmed, phone);
    setLoading(false);
    router.replace('/(customer)/profile' as any);
  };

  const stepNumber = step === 'phone' ? 1 : step === 'otp' ? 2 : 3;

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
              if (step === 'otp') setStep('phone');
              else if (step === 'name') setStep('otp');
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
            {[1, 2, 3].map(i => (
              <View key={i} style={[s.progressDot, i <= stepNumber && s.progressDotActive]} />
            ))}
          </View>

          {/* STEP 1: Phone */}
          {step === 'phone' && (
            <>
              <Text style={s.title}>Telefon Numaranız</Text>
              <Text style={s.subtitle}>Size bir doğrulama kodu göndereceğiz</Text>

              <View style={s.phoneRow}>
                <View style={s.prefixBox}>
                  <Text style={s.prefixText}>+90</Text>
                </View>
                <TextInput
                  style={s.phoneInput}
                  value={formatLocalDisplay(localDigits)}
                  onChangeText={onChangePhone}
                  placeholder="5xx xxx xx xx"
                  placeholderTextColor="#C4B8AA"
                  keyboardType="phone-pad"
                  autoFocus
                />
              </View>
            </>
          )}

          {/* STEP 2: OTP */}
          {step === 'otp' && (
            <>
              <Text style={s.title}>Doğrulama Kodu</Text>
              <Text style={s.subtitle}>
                +90 {formatLocalDisplay(localDigits)} numarasına gönderildi
              </Text>

              <TextInput
                style={s.otpInput}
                value={otp}
                onChangeText={t => { setOtp(t.replace(/\D/g, '').slice(0, 6)); setError(null); }}
                placeholder="• • • • • •"
                placeholderTextColor="#C4B8AA"
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />

              <View style={s.demoHint}>
                <Text style={s.demoHintText}>Demo mod: Kodu 123456 olarak girin</Text>
              </View>
            </>
          )}

          {/* STEP 3: Name */}
          {step === 'name' && (
            <>
              <Text style={s.title}>Adınız Nedir?</Text>
              <Text style={s.subtitle}>Siparişlerinizde bu isim kullanılacak</Text>

              <TextInput
                style={s.nameInput}
                value={name}
                onChangeText={t => { setName(t); setError(null); }}
                placeholder="Adınız Soyadınız"
                placeholderTextColor="#C4B8AA"
                autoCapitalize="words"
                autoFocus
              />
            </>
          )}

          {error ? <Text style={s.error}>{error}</Text> : null}

          <Pressable
            style={[s.primaryBtn, loading && s.btnDisabled]}
            onPress={step === 'phone' ? sendOtp : step === 'otp' ? verifyOtp : createAccount}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.primaryBtnText}>
                {step === 'name' ? 'Hesap Oluştur' : 'Devam Et'}
              </Text>
            )}
          </Pressable>

          <View style={s.footerRow}>
            <Text style={s.muted}>Zaten hesabınız var mı? </Text>
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
  subtitle: { fontSize: 14, color: '#A89A8A', marginBottom: 28, lineHeight: 20 },

  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  prefixBox: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#EDE8E2',
  },
  prefixText: { fontSize: 17, fontWeight: '700', color: '#1A1208' },
  phoneInput: {
    flex: 1,
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#EDE8E2',
    color: '#1A1208',
    fontWeight: '600',
  },

  otpInput: {
    fontSize: 28,
    letterSpacing: 12,
    textAlign: 'center',
    paddingVertical: 18,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#EDE8E2',
    color: '#1A1208',
    fontWeight: '700',
  },

  demoHint: {
    backgroundColor: '#FFF8E1',
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
    alignItems: 'center',
  },
  demoHintText: { fontSize: 12, color: '#F57F17', fontWeight: '600' },

  nameInput: {
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#EDE8E2',
    color: '#1A1208',
    fontWeight: '600',
  },

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
