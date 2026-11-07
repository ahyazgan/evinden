import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/lib/auth-context';
import { fetchPhoneVerificationRequired } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { normalizeTrPhone } from '@/lib/phone';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme-context';

const RESEND_SECONDS = 60;

/** Ayar açıksa ve hesabın telefonu doğrulanmamışsa true. Sunucu da ayrıca denetler (031). */
export async function phoneVerificationNeeded(): Promise<boolean> {
  const required = await fetchPhoneVerificationRequired().catch(() => false);
  if (!required) return false;
  const { data } = await supabase.auth.getUser();
  return !data.user?.phone_confirmed_at;
}

function smsErrorMessage(message: string | undefined): string {
  const text = (message ?? '').toLowerCase();
  if (text.includes('already') || text.includes('registered')) return 'Bu numara başka bir hesapta kayıtlı.';
  if (text.includes('expired') || text.includes('invalid')) return 'Kod hatalı ya da süresi dolmuş. Yeni kod iste.';
  if (text.includes('rate') || text.includes('seconds') || text.includes('too many')) return 'Çok sık denedin, biraz bekle.';
  return 'Şu an kod gönderemedik. Biraz sonra tekrar dene.';
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onVerified: () => void;
};

/** Siparişten önce telefonu SMS koduyla doğrular. */
export function PhoneVerifyModal({ visible, onClose, onVerified }: Props) {
  const { colors: t } = useTheme();
  const { profile, updateProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(w => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  useEffect(() => {
    if (!visible) {
      setSentTo(null);
      setCode('');
      setError(null);
    }
  }, [visible]);

  const send = async () => {
    const normalized = normalizeTrPhone(phone);
    if (!normalized) {
      setError('Geçerli bir cep numarası yaz: 05XX XXX XX XX');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ phone: normalized });
    setBusy(false);
    if (err) {
      setError(smsErrorMessage(err.message));
      return;
    }
    setSentTo(normalized);
    setWait(RESEND_SECONDS);
  };

  const verify = async () => {
    if (!sentTo) return;
    if (code.trim().length < 4) {
      setError('SMS ile gelen kodu yaz.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ phone: sentTo, token: code.trim(), type: 'phone_change' });
    if (err) {
      setBusy(false);
      setError(smsErrorMessage(err.message));
      return;
    }
    await updateProfile({ phone: sentTo }).catch(() => undefined);
    setBusy(false);
    onVerified();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.sheet, { backgroundColor: t.surface, paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={s.head}>
            <Text style={[s.title, { color: t.heading }]}>Telefonunu doğrula</Text>
            <Pressable style={[s.close, { backgroundColor: t.background }]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Kapat">
              <Ionicons name="close" size={20} color={t.text} />
            </Pressable>
          </View>

          {sentTo ? (
            <>
              <Text style={[s.sub, { color: t.textSecondary }]}>{sentTo} numarasına gelen kodu yaz.</Text>
              <Input
                label="Doğrulama kodu"
                accessibilityLabel="Doğrulama kodu"
                value={code}
                onChangeText={v => { setCode(v.replace(/\D/g, '')); setError(null); }}
                placeholder="6 haneli kod"
                keyboardType="number-pad"
                autoComplete="sms-otp"
                textContentType="oneTimeCode"
                maxLength={8}
                autoFocus
              />
              {error ? <Text style={[s.error, { color: t.danger }]}>{error}</Text> : null}
              <Button label="Doğrula ve devam et" size="lg" fullWidth loading={busy} onPress={verify} />
              <Button
                label={wait > 0 ? `Yeni kod: ${wait} sn` : 'Yeni kod gönder'}
                variant="ghost"
                fullWidth
                disabled={wait > 0 || busy}
                onPress={send}
              />
            </>
          ) : (
            <>
              <Text style={[s.sub, { color: t.textSecondary }]}>Kurye sana ulaşabilsin diye numaranı bir kez doğruluyoruz.</Text>
              <Input
                label="Cep telefonu"
                accessibilityLabel="Cep telefonu"
                value={phone}
                onChangeText={v => { setPhone(v); setError(null); }}
                placeholder="05XX XXX XX XX"
                keyboardType="phone-pad"
                autoComplete="tel"
              />
              {error ? <Text style={[s.error, { color: t.danger }]}>{error}</Text> : null}
              <Button label="Kod gönder" size="lg" fullWidth loading={busy} onPress={send} />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(21,26,22,0.5)' },
  sheet: { width: '100%', maxWidth: 480, alignSelf: 'center', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, fontSize: 22, lineHeight: 28, fontFamily: fonts.display, letterSpacing: -0.4 },
  close: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sub: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular },
  error: { fontSize: 13, lineHeight: 18, fontFamily: fonts.semibold },
});
