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
import { SELLER_AGREEMENTS, COMMISSION_TIERS } from '@/constants/business';
import { useAuth } from '@/lib/auth-context';
import { formatLocalDisplay, toTurkeyE164 } from '@/lib/phone';
import type { AppUserRole } from '@/types';

type Step = 'form' | 'otp';

const DEMO_OTP = '123456';

export default function RegisterScreen() {
  const { demoRegister } = useAuth();
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [localDigits, setLocalDigits] = useState('');
  const [role, setRole] = useState<AppUserRole | null>(null);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreements, setAgreements] = useState<Record<string, boolean>>({});
  const [showFullText, setShowFullText] = useState<string | null>(null);

  const toggleAgreement = (id: string) => {
    setAgreements(prev => ({ ...prev, [id]: !prev[id] }));
    setError(null);
  };

  const allAgreementsAccepted = SELLER_AGREEMENTS.every(a => agreements[a.id]);

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
    if (role === 'seller' && !allAgreementsAccepted) {
      setError('Satıcı olarak devam etmek için tüm sözleşmeleri kabul etmelisiniz.');
      return;
    }
    const phone = toTurkeyE164(localDigits);
    if (!phone) {
      setError('Lütfen geçerli bir Türkiye cep telefonu girin (10 hane, 5 ile başlamalı).');
      return;
    }
    // Demo: go straight to OTP
    setStep('otp');
    setOtp('');
    setError(null);
  };

  const verifyAndCreateProfile = async () => {
    if (otp.length !== 6) {
      setError('Lütfen 6 haneli doğrulama kodunu girin.');
      return;
    }
    if (otp !== DEMO_OTP) {
      setError('Doğrulama kodu hatalı. Demo kod: 123456');
      return;
    }
    if (!role) {
      setError('Rol bilgisi eksik.');
      return;
    }

    setLoading(true);
    setError(null);
    const phone = toTurkeyE164(localDigits)!;
    await demoRegister(name.trim(), phone, role);
    setLoading(false);
    // AuthGate will handle routing
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
          </View>

          <Text style={styles.title}>Kayıt Ol</Text>
          <Text style={styles.subtitle}>
            {step === 'form'
              ? 'Bilgilerinizi girin ve rolünüzü seçin'
              : 'Demo doğrulama kodu: 123456'}
          </Text>

          {step === 'form' ? (
            <>
              <Text style={styles.label}>Ad Soyad</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={(t) => { setName(t); setError(null); }}
                placeholder="Adınız Soyadınız"
                placeholderTextColor="#B8AFA4"
                editable={!loading}
                autoCapitalize="words"
              />

              <Text style={[styles.label, styles.labelSp]}>Cep Telefonu</Text>
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

              <Text style={[styles.label, styles.labelSp]}>Nasıl devam etmek istersiniz?</Text>
              <View style={styles.cardsRow}>
                <Pressable
                  style={[styles.card, role === 'buyer' && styles.cardSelected]}
                  onPress={() => { setRole('buyer'); setError(null); }}
                  disabled={loading}
                >
                  <Text style={styles.cardEmoji}>🍽️</Text>
                  <Text style={[styles.cardTitle, role === 'buyer' && styles.cardTitleSelected]}>
                    Yemek Sipariş Etmek İstiyorum
                  </Text>
                  <Text style={styles.cardHint}>Ev yemeklerini keşfet, sipariş ver</Text>
                </Pressable>

                <Pressable
                  style={[styles.card, role === 'seller' && styles.cardSelected]}
                  onPress={() => { setRole('seller'); setError(null); }}
                  disabled={loading}
                >
                  <Text style={styles.cardEmoji}>🧑‍🍳</Text>
                  <Text style={[styles.cardTitle, role === 'seller' && styles.cardTitleSelected]}>
                    Yemek Satmak İstiyorum
                  </Text>
                  <Text style={styles.cardHint}>Ev mutfağından satış yap</Text>
                </Pressable>
              </View>

              {/* Seller agreements */}
              {role === 'seller' && (
                <View style={styles.agreementsSection}>
                  <Text style={styles.agreementsTitle}>Satıcı Sözleşmeleri</Text>
                  <Text style={styles.agreementsSub}>
                    Satıcı olarak kayıt olmak için aşağıdaki gereklilikleri kabul etmelisiniz.
                  </Text>

                  {/* Commission info */}
                  <View style={styles.commissionBox}>
                    <Text style={styles.commissionTitle}>Komisyon Oranları</Text>
                    {COMMISSION_TIERS.map(t => (
                      <View key={t.id} style={styles.commissionRow}>
                        <Text style={styles.commissionLabel}>{t.label}</Text>
                        <Text style={styles.commissionDesc}>{t.description}</Text>
                        <Text style={styles.commissionRate}>%{t.rate}</Text>
                      </View>
                    ))}
                  </View>

                  {SELLER_AGREEMENTS.map(agreement => (
                    <View key={agreement.id} style={styles.agreementItem}>
                      <Pressable
                        style={styles.checkboxRow}
                        onPress={() => toggleAgreement(agreement.id)}
                      >
                        <View style={[styles.checkbox, agreements[agreement.id] && styles.checkboxChecked]}>
                          {agreements[agreement.id] && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <Text style={styles.checkboxLabel}>{agreement.checkboxLabel}</Text>
                      </Pressable>
                      <Text style={styles.agreementDesc}>{agreement.description}</Text>
                      {'fullText' in agreement && (
                        <Pressable onPress={() => setShowFullText(showFullText === agreement.id ? null : agreement.id)}>
                          <Text style={styles.readMore}>
                            {showFullText === agreement.id ? '▲ Kapat' : '▼ Sözleşmeyi Oku'}
                          </Text>
                        </Pressable>
                      )}
                      {showFullText === agreement.id && 'fullText' in agreement && (
                        <View style={styles.fullTextBox}>
                          <Text style={styles.fullText}>{agreement.fullText}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : (
            <>
              <Text style={styles.label}>Doğrulama Kodu</Text>
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
              <Pressable onPress={() => setStep('form')} disabled={loading} style={styles.linkBtn}>
                <Text style={styles.linkMuted}>← Bilgileri düzenle</Text>
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
                {step === 'form' ? 'Devam Et' : 'Kayıt Ol'}
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
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 48,
  },
  logoWrap: { alignItems: 'center', marginBottom: 20 },
  logoEmoji: { fontSize: 48 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1A1208',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#8A7E72',
    marginBottom: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B5E50',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  labelSp: { marginTop: 18 },
  input: {
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
  cardsRow: { gap: 12, marginTop: 4 },
  card: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#EDE8E2',
  },
  cardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#FFF5F2',
  },
  cardEmoji: { fontSize: 36, lineHeight: 44 },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1208',
    marginTop: 10,
  },
  cardTitleSelected: { color: colors.primary },
  cardHint: { fontSize: 13, color: '#8A7E72', marginTop: 4 },
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
    marginTop: 28,
    flexWrap: 'wrap',
  },
  muted: { color: '#8A7E72', fontSize: 15 },
  link: { color: colors.primary, fontSize: 15, fontWeight: '700' },

  // Seller agreements
  agreementsSection: { marginTop: 24, gap: 12 },
  agreementsTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208' },
  agreementsSub: { fontSize: 13, color: '#8A7E72', marginBottom: 4 },

  commissionBox: { backgroundColor: '#FFF8E1', borderRadius: 14, padding: 14, gap: 8 },
  commissionTitle: { fontSize: 14, fontWeight: '700', color: '#F57F17', marginBottom: 4 },
  commissionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commissionLabel: { fontSize: 13, fontWeight: '700', color: '#1A1208', width: 90 },
  commissionDesc: { fontSize: 12, color: '#8A7E72', flex: 1 },
  commissionRate: { fontSize: 15, fontWeight: '800', color: colors.primary },

  agreementItem: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#EDE8E2', gap: 8 },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#D1C9BE', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '800' },
  checkboxLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: '#1A1208', lineHeight: 19 },
  agreementDesc: { fontSize: 12, color: '#8A7E72', lineHeight: 17, marginLeft: 32 },
  readMore: { fontSize: 12, fontWeight: '700', color: colors.primary, marginLeft: 32, marginTop: 2 },
  fullTextBox: { backgroundColor: '#FAF7F2', borderRadius: 10, padding: 12, marginTop: 4 },
  fullText: { fontSize: 11, color: '#6B5E50', lineHeight: 16 },
});
