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
import { useAuth } from '@/lib/auth-context';
import { mapAuthErrorToTurkish } from '@/lib/auth-errors';
import { formatLocalDisplay, toTurkeyE164 } from '@/lib/phone';
import { supabase } from '@/lib/supabase';
import type { AppUserRole } from '@/types';

type Step = 'form' | 'otp';

export default function RegisterScreen() {
  const { refreshProfile } = useAuth();
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [localDigits, setLocalDigits] = useState('');
  const [e164, setE164] = useState<string | null>(null);
  const [role, setRole] = useState<AppUserRole | null>(null);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChangePhone = (text: string) => {
    setLocalDigits(text.replace(/\D/g, '').slice(0, 10));
    setError(null);
  };

  const sendOtp = async () => {
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError('Lütfen adınızı ve soyadınızı girin.');
      return;
    }
    if (!role) {
      setError('Lütfen devam etmek için bir rol seçin.');
      return;
    }
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
        shouldCreateUser: true,
        data: {
          name: trimmedName,
          role,
        },
      },
    });
    setLoading(false);
    if (err) {
      setError(mapAuthErrorToTurkish(err));
      return;
    }
    setE164(phone);
    setStep('otp');
    setOtp('');
  };

  const verifyAndCreateProfile = async () => {
    if (!e164 || otp.length !== 6) {
      setError('Lütfen 6 haneli doğrulama kodunu girin.');
      return;
    }
    const trimmedName = name.trim();
    if (!role) {
      setError('Rol bilgisi eksik.');
      return;
    }

    setLoading(true);
    setError(null);
    const { data: verifyData, error: verifyErr } = await supabase.auth.verifyOtp({
      phone: e164,
      token: otp.trim(),
      type: 'sms',
    });
    if (verifyErr) {
      setLoading(false);
      setError(mapAuthErrorToTurkish(verifyErr));
      return;
    }

    const uid = verifyData.session?.user?.id;
    if (!uid) {
      setLoading(false);
      setError('Oturum oluşturulamadı. Lütfen tekrar deneyin.');
      return;
    }

    const isApproved = role === 'buyer';

    const { error: insertErr } = await supabase.from('users').upsert(
      {
        id: uid,
        name: trimmedName,
        phone: e164,
        role,
        is_approved: isApproved,
        avatar_url: null,
      },
      { onConflict: 'id' },
    );

    if (insertErr) {
      setLoading(false);
      setError(insertErr.message.includes('unique') || insertErr.code === '23505'
        ? 'Bu telefon numarası başka bir hesaba bağlı.'
        : insertErr.message);
      return;
    }

    await refreshProfile();
    setLoading(false);
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
          <Text style={styles.title}>Kayıt ol</Text>
          <Text style={styles.subtitle}>
            {step === 'form'
              ? 'Bilgilerinizi girin ve rolünüzü seçin'
              : 'SMS ile gelen 6 haneli kodu girin'}
          </Text>

          {step === 'form' ? (
            <>
              <Text style={styles.label}>Ad soyad</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  setError(null);
                }}
                placeholder="Adınız Soyadınız"
                placeholderTextColor="#999"
                editable={!loading}
                autoCapitalize="words"
              />

              <Text style={[styles.label, styles.labelSp]}>Cep telefonu</Text>
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

              <Text style={[styles.label, styles.labelSp]}>Nasıl devam etmek istersiniz?</Text>
              <View style={styles.cardsRow}>
                <Pressable
                  style={[styles.card, role === 'buyer' && styles.cardSelected]}
                  onPress={() => {
                    setRole('buyer');
                    setError(null);
                  }}
                  disabled={loading}
                >
                  <Text style={styles.cardEmoji} accessibilityLabel="Müşteri">
                    🍽️
                  </Text>
                  <Text style={[styles.cardTitle, role === 'buyer' && styles.cardTitleSelected]}>
                    Yemek Sipariş Etmek İstiyorum
                  </Text>
                  <Text style={styles.cardHint}>Ev yemeklerini keşfet, sipariş ver</Text>
                </Pressable>

                <Pressable
                  style={[styles.card, role === 'seller' && styles.cardSelected]}
                  onPress={() => {
                    setRole('seller');
                    setError(null);
                  }}
                  disabled={loading}
                >
                  <Text style={styles.cardEmoji} accessibilityLabel="Satıcı">
                    🧑‍🍳
                  </Text>
                  <Text style={[styles.cardTitle, role === 'seller' && styles.cardTitleSelected]}>
                    Yemek Satmak İstiyorum
                  </Text>
                  <Text style={styles.cardHint}>Ev mutfağından satış yap</Text>
                </Pressable>
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
              <Pressable onPress={() => setStep('form')} disabled={loading} style={styles.linkBtn}>
                <Text style={styles.linkMuted}>Bilgileri düzenle</Text>
              </Pressable>
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.primaryBtn, loading && styles.btnDisabled]}
            onPress={step === 'form' ? sendOtp : verifyAndCreateProfile}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {step === 'form' ? 'Kayıt ol' : 'Doğrula ve devam et'}
              </Text>
            )}
          </Pressable>

          <View style={styles.footerRow}>
            <Text style={styles.muted}>Zaten hesabınız var mı? </Text>
            <Link href="/(auth)/login" asChild>
              <Pressable>
                <Text style={styles.link}>Giriş yap</Text>
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
    paddingTop: 24,
    paddingBottom: 48,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.secondary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.secondary,
    marginBottom: 8,
  },
  labelSp: { marginTop: 16 },
  input: {
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E4DD',
    color: colors.secondary,
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
  cardsRow: { gap: 14, marginTop: 4 },
  cardEmoji: {
    fontSize: 40,
    lineHeight: 48,
  },
  card: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#E8E4DD',
  },
  cardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#FFF5F2',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.secondary,
    marginTop: 12,
  },
  cardTitleSelected: { color: colors.primary },
  cardHint: { fontSize: 13, color: '#888', marginTop: 6 },
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
    marginTop: 28,
    flexWrap: 'wrap',
  },
  muted: { color: '#666', fontSize: 15 },
  link: { color: colors.primary, fontSize: 15, fontWeight: '700' },
});
