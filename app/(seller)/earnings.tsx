import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  fetchMyEarnings,
  fetchMyPayouts,
  fetchPayoutAccount,
  fetchSellerByUserId,
  savePayoutAccount,
  type EarningsSummary,
  type PayoutRow,
} from '@/lib/db';
import { formatIban, normalizeTurkishIban, periodRange, type EarningsPeriod } from '@/lib/earnings';
import { fonts } from '@/lib/fonts';

const PERIODS: [EarningsPeriod, string][] = [['week', 'Bu Hafta'], ['month', 'Bu Ay'], ['last_month', 'Geçen Ay']];

function priceTL(cents: number): string {
  return `₺${(Math.abs(cents) / 100).toFixed(2).replace('.', ',')}`;
}

function StatRow({ label, value, minus, strong }: { label: string; value: number; minus?: boolean; strong?: boolean }) {
  return (
    <View style={[st.statRow, strong && st.statRowStrong]}>
      <Text style={[st.statLabel, strong && st.statLabelStrong]}>{label}</Text>
      <Text style={[st.statValue, strong && st.statValueStrong]}>{minus && value > 0 ? '-' : ''}{priceTL(value)}</Text>
    </View>
  );
}

export default function EarningsScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [period, setPeriod] = useState<EarningsPeriod>('week');
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [iban, setIban] = useState('');
  const [accountName, setAccountName] = useState('');
  const [savingAccount, setSavingAccount] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    fetchSellerByUserId(profile.id)
      .then(async seller => {
        if (!seller) {
          setFailed(true);
          setLoading(false);
          return;
        }
        setSellerId(seller.id);
        const account = await fetchPayoutAccount(seller.id);
        if (account) {
          setIban(formatIban(account.iban));
          setAccountName(account.account_name);
        }
      })
      .catch(() => setFailed(true));
  }, [profile?.id]);

  const load = useCallback(async () => {
    if (!sellerId) return;
    try {
      const { from, to } = periodRange(period);
      const [s, p] = await Promise.all([fetchMyEarnings(from, to), fetchMyPayouts(sellerId)]);
      setSummary(s);
      setPayouts(p);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [sellerId, period]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const saveAccount = async () => {
    if (!sellerId || savingAccount) return;
    const clean = normalizeTurkishIban(iban);
    if (!clean) {
      Alert.alert('IBAN geçersiz', 'TR ile başlayan 26 haneli IBAN numaranızı kontrol edin.');
      return;
    }
    if (accountName.trim().length < 3) {
      Alert.alert('Hesap sahibi', 'Hesap sahibinin adını yazın.');
      return;
    }
    setSavingAccount(true);
    try {
      await savePayoutAccount(sellerId, clean, accountName.trim());
      setIban(formatIban(clean));
      Alert.alert('Kaydedildi', 'Ödeme hesabınız güncellendi.');
    } catch {
      Alert.alert('Kaydedilemedi', 'Lütfen tekrar deneyin.');
    } finally {
      setSavingAccount(false);
    }
  };

  const balance = summary?.open_balance_cents ?? 0;

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={20} color="#151A16" />
        </Pressable>
        <Text style={st.headerTitle}>Kazancım</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading && !failed ? (
        <View style={st.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={st.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {failed && <Text style={st.error}>Veriler yüklenemedi. Aşağı çekip yenileyin.</Text>}

          <View style={[st.balanceCard, balance < 0 && st.balanceCardOwed]}>
            <Text style={st.balanceLabel}>
              {balance > 0 ? 'Size ödenecek' : balance < 0 ? 'Platforma ödenecek komisyon' : 'Açık bakiyeniz yok'}
            </Text>
            <Text style={st.balanceValue}>{priceTL(balance)}</Text>
            {!!summary?.open_order_count && (
              <Text style={st.balanceSub}>{summary.open_order_count} sipariş sonraki hesap kesiminde</Text>
            )}
            {!!summary?.held_count && (
              <Text style={st.balanceSub}>{summary.held_count} sipariş iade incelemesinde, sonuçlanınca eklenir</Text>
            )}
          </View>

          <View style={st.pillRow}>
            {PERIODS.map(([key, label]) => (
              <Pressable key={key} style={[st.pill, period === key && st.pillActive]} onPress={() => setPeriod(key)}>
                <Text style={[st.pillText, period === key && st.pillTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={st.card}>
            <Text style={st.cardTitle}>{summary?.order_count ?? 0} teslim edilen sipariş</Text>
            <StatRow label="Satış ve teslimat" value={summary?.gross_cents ?? 0} />
            <StatRow label="Kampanya indirimleriniz" value={summary?.seller_discount_cents ?? 0} minus />
            <StatRow label="Platform komisyonu" value={summary?.commission_cents ?? 0} minus />
            <StatRow label="Net kazanç" value={summary?.net_cents ?? 0} strong />
            <Text style={st.hint}>
              Nakit ve kapıda kartla {priceTL(summary?.collected_cents ?? 0)} doğrudan size ödendi. Online ödemeler platforma gelir,
              hesap kesiminde size aktarılır.
            </Text>
          </View>

          <View style={st.card}>
            <Text style={st.cardTitle}>Ödeme hesabı</Text>
            <Text style={st.label}>IBAN</Text>
            <TextInput
              style={st.input}
              value={iban}
              onChangeText={setIban}
              placeholder="TR00 0000 0000 0000 0000 0000 00"
              placeholderTextColor="#A3ACA5"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={34}
            />
            <Text style={st.label}>Hesap sahibi</Text>
            <TextInput
              style={st.input}
              value={accountName}
              onChangeText={setAccountName}
              placeholder="Ad Soyad veya şirket unvanı"
              placeholderTextColor="#A3ACA5"
              maxLength={100}
            />
            <Pressable style={[st.saveBtn, savingAccount && st.disabled]} onPress={saveAccount} disabled={savingAccount || !sellerId}>
              <Text style={st.saveText}>{savingAccount ? 'Kaydediliyor...' : 'Kaydet'}</Text>
            </Pressable>
          </View>

          <Text style={st.sectionTitle}>Hesap kesimleri</Text>
          {payouts.length === 0 ? (
            <Text style={st.emptyText}>Henüz hesap kesimi yapılmadı.</Text>
          ) : (
            payouts.map(p => (
              <View key={p.id} style={st.payoutRow}>
                <View style={st.payoutBody}>
                  <Text style={st.payoutTitle}>{p.amount_cents >= 0 ? 'Size ödendi' : 'Komisyon ödemeniz'}</Text>
                  <Text style={st.payoutSub}>
                    {new Date(p.created_at).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' })}
                    {' · '}{p.order_count} sipariş
                  </Text>
                  {!!p.note && <Text style={st.payoutSub}>{p.note}</Text>}
                </View>
                <Text style={[st.payoutAmount, p.amount_cents < 0 && st.payoutAmountOut]}>{priceTL(p.amount_cents)}</Text>
              </View>
            ))
          )}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF8F2' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E3E6DE',
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EFF2EA', alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, fontFamily: fonts.display, color: '#151A16', marginTop: -2 },
  headerTitle: { fontSize: 18, fontFamily: fonts.display, color: '#151A16' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 14 },
  error: { fontFamily: fonts.regular, fontSize: 13, color: '#C62828', textAlign: 'center' },

  balanceCard: { backgroundColor: '#2E7D32', borderRadius: 18, padding: 20, gap: 4 },
  balanceCardOwed: { backgroundColor: '#17402F' },
  balanceLabel: { fontSize: 13, fontFamily: fonts.semibold, color: 'rgba(255,255,255,0.85)' },
  balanceValue: { fontSize: 30, fontFamily: fonts.display, color: '#fff' },
  balanceSub: { fontFamily: fonts.regular, fontSize: 12, color: 'rgba(255,255,255,0.8)' },

  pillRow: { flexDirection: 'row', gap: 8 },
  pill: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E3E6DE', alignItems: 'center' },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontSize: 13, fontFamily: fonts.semibold, color: '#56605A' },
  pillTextActive: { color: '#fff' },

  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E3E6DE', gap: 10 },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: '#151A16' },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  statRowStrong: { borderTopWidth: 1, borderTopColor: '#E3E6DE', paddingTop: 10 },
  statLabel: { fontFamily: fonts.regular, fontSize: 14, color: '#56605A', flex: 1 },
  statLabelStrong: { fontFamily: fonts.bold, color: '#151A16' },
  statValue: { fontSize: 14, fontFamily: fonts.semibold, color: '#151A16' },
  statValueStrong: { fontSize: 16, fontFamily: fonts.extrabold },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', lineHeight: 17 },

  label: { fontSize: 12, fontFamily: fonts.bold, color: '#56605A' },
  input: { backgroundColor: '#FAF8F2', borderRadius: 12, padding: 12, fontFamily: fonts.regular, fontSize: 15, color: '#151A16', borderWidth: 1, borderColor: '#E3E6DE' },
  saveBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  saveText: { color: '#fff', fontSize: 14, fontFamily: fonts.bold },
  disabled: { opacity: 0.5 },

  sectionTitle: { fontSize: 15, fontFamily: fonts.extrabold, color: '#151A16', marginTop: 4 },
  emptyText: { fontFamily: fonts.regular, fontSize: 13, color: '#6B766F' },
  payoutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#E3E6DE' },
  payoutBody: { flex: 1, gap: 2 },
  payoutTitle: { fontSize: 14, fontFamily: fonts.bold, color: '#151A16' },
  payoutSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F' },
  payoutAmount: { fontSize: 15, fontFamily: fonts.extrabold, color: '#2E7D32' },
  payoutAmountOut: { color: '#151A16' },
});
