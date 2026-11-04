import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { adminFetchFraudFlags, adminReviewFraudFlag, type FraudFlagRow, type FraudReason } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { paymentLabel } from '@/lib/order-options';
import { useTheme } from '@/lib/theme-context';

const TABS = [
  { reviewed: false, label: 'Bekleyen' },
  { reviewed: true, label: 'İncelenen' },
];

const REASON_LABEL: Record<FraudReason, string> = {
  new_account_large_total: 'Yeni hesaptan yüksek tutar',
  order_burst: 'Kısa sürede çok sipariş',
};

function priceTL(cents: number) {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

export default function AdminFraudScreen() {
  const { colors: t } = useTheme();
  const router = useRouter();
  const [reviewed, setReviewed] = useState(false);
  const [flags, setFlags] = useState<FraudFlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setFlags(await adminFetchFraudFlags(reviewed));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [reviewed]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const review = async (flag: FraudFlagRow) => {
    setBusy(flag.id);
    try {
      await adminReviewFraudFlag(flag.id);
      setFlags(list => list.filter(f => f.id !== flag.id));
    } catch (e: any) {
      Alert.alert('Kaydedilemedi', e?.message ?? 'Tekrar dene.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[s.safe, { backgroundColor: t.background }]}>
      <TopBar title="İşaretli siparişler" subtitle="Engellemez, incelemen için gösterir" back />
      <View style={s.tabs}>
        {TABS.map(tab => {
          const on = reviewed === tab.reviewed;
          return (
            <Pressable
              key={tab.label}
              style={[s.chip, { backgroundColor: on ? t.brand : t.surface }]}
              hitSlop={2}
              onPress={() => setReviewed(tab.reviewed)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[s.chipText, { color: on ? t.onBrand : t.text }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={t.primary} /></View>
      ) : failed ? (
        <View style={s.center}>
          <Text style={[s.emptyText, { color: t.textSecondary }]}>Liste açılamadı.</Text>
          <Button label="Tekrar dene" onPress={load} />
        </View>
      ) : flags.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="checkmark-circle-outline" size={44} color={t.textMuted} />
          <Text style={[s.emptyText, { color: t.textSecondary }]}>
            {reviewed ? 'İncelenmiş kayıt yok.' : 'İnceleme bekleyen sipariş yok.'}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.list} showsVerticalScrollIndicator={false}>
          {flags.map(flag => (
            <View key={flag.id} style={[s.card, { backgroundColor: t.surface }]}>
              <Text style={[s.reason, { color: t.text }]}>{REASON_LABEL[flag.reason] ?? flag.reason}</Text>
              <Text style={[s.meta, { color: t.textSecondary }]}>
                {flag.user_name || 'Silinmiş hesap'} · {flag.restaurant_name}
              </Text>
              <Text style={[s.meta, { color: t.textSecondary }]}>
                {priceTL(flag.total_cents)} · {paymentLabel(flag.payment_method)} · {new Date(flag.created_at).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </Text>
              <Pressable style={s.orderLink} onPress={() => router.push('/(admin)/orders' as any)} accessibilityRole="link">
                <Ionicons name="receipt-outline" size={14} color={t.textSecondary} />
                <Text style={[s.meta, { color: t.textSecondary }]}>Sipariş #{flag.order_id.slice(0, 8).toUpperCase()}</Text>
              </Pressable>
              {flag.reviewed_at ? null : (
                <Button label="İncelendi" variant="outline" fullWidth loading={busy === flag.id} onPress={() => review(flag)} />
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontFamily: fonts.bold },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyText: { fontSize: 14, fontFamily: fonts.regular, textAlign: 'center' },
  list: { padding: 16, gap: 10 },
  card: { borderRadius: 16, padding: 14, gap: 4 },
  reason: { fontSize: 15, fontFamily: fonts.bold },
  meta: { fontSize: 12, lineHeight: 17, fontFamily: fonts.medium },
  orderLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
});
