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
import { Link } from 'expo-router';

import { colors } from '@/constants/theme';
import { mapAuthErrorToTurkish } from '@/lib/auth-errors';
import { formatLocalDisplay, toTurkeyE164 } from '@/lib/phone';
import { supabase } from '@/lib/supabase';

type Step = 'phone' | 'otp';

export default function LoginScreen() {
  const [step, setStep] = useState<Step>('phone');
  const [localDigits, setLocalDigits] = useState('');
  const [e164, setE164] = useState<string | null>(null);
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
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      phone,
      options: {
        shouldCreateUser: false,
      },
    });
    setLoading(false);
    if (err) {
      setError(
        err.message.toLowerCase().includes('signups not allowed') ||
          err.message.toLowerCase().includes('not found')
          ? 'Bu numara ile kayıtlı hesap bulunamadı. Önce kayıt olun.'
          : mapAuthErrorToTurkish(err),
      );
      return;
    }
    setE164(phone);
    setStep('otp');
    setOtp('');
  };

  const verify = async () => {
    if (!e164 || otp.length !== 6) {
      setError('Lütfen 6 haneli doğrulama kodunu girin.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      phone: e164,
      token: otp.trim(),
      type: 'sms',
    });
    setLoading(false);
    if (err) {
      setError(mapAuthErrorToTurkish(err));
      return;
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
          <Text style={styles.title}>evinden</Text>
          <Text style={styles.subtitle}>
            {step === 'phone' ? 'Telefon numaranızla giriş yapın' : 'SMS ile gelen 6 haneli kodu girin'}
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
                  placeholderTextColor="#999"
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
                placeholder="••••••"
                placeholderTextColor="#999"
                keyboardType="number-pad"
                maxLength={6}
                editable={!loading}
              />
              <Pressable onPress={() => setStep('phone')} disabled={loading} style={styles.linkBtn}>
                <Text style={styles.linkMuted}>Numarayı değiştir</Text>
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
              <Text style={styles.primaryBtnText}>{step === 'phone' ? 'Devam Et' : 'Doğrula'}</Text>
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
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.secondary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 32,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.secondary,
    marginBottom: 8,
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
    borderWidth: 1,
    borderColor: '#E8E4DD',
  },
  prefixText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.secondary,
  },
  phoneInput: {
    flex: 1,
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E4DD',
    color: colors.secondary,
  },
  otpInput: {
    fontSize: 28,
    letterSpacing: 8,
    textAlign: 'center',
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E4DD',
    color: colors.secondary,
  },
  error: {
    color: colors.primary,
    marginTop: 12,
    fontSize: 14,
  },
  primaryBtn: {
    marginTop: 24,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.7 },
  primaryBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  linkBtn: { marginTop: 16, alignSelf: 'center' },
  linkMuted: { color: '#888', fontSize: 14 },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 32,
    flexWrap: 'wrap',
  },
  muted: { color: '#666', fontSize: 15 },
  link: { color: colors.primary, fontSize: 15, fontWeight: '700' },
});
