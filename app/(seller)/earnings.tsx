import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
import { useTheme } from '@/lib/theme-context';

const PERIODS: [EarningsPeriod, string][] = [['week', 'Bu hafta'], ['month', 'Bu ay'], ['last_month', 'Geçen ay']];

function priceTL(cents: number): string {
  return `₺${(Math.abs(cents) / 100).toFixed(2).replace('.', ',')}`;
}

function StatRow({ label, value, minus, strong }: { label: string; value: number; minus?: boolean; strong?: boolean }) {
  const { colors: t } = useTheme();
  return (
    <View style={[st.statRow, strong && st.statRowStrong, strong && { borderTopColor: t.divider }]}>
      <Text style={[st.statLabel, { color: strong ? t.text : t.textSecondary }, strong && st.statLabelStrong]}>{label}</Text>
      <Text style={[st.statValue, { color: t.text }, strong && st.statValueStrong]}>{minus && value > 0 ? '-' : ''}{priceTL(value)}</Text>
    </View>
  );
}

export default function EarningsScreen() {
  const { colors: t } = useTheme();
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
      Alert.alert('IBAN geçersiz', 'TR ile başlayan 26 haneli IBAN numaranı kontrol et.');
      return;
    }
    if (accountName.trim().length < 3) {
      Alert.alert('Hesap sahibi', 'Hesap sahibinin adını yaz.');
      return;
    }
    setSavingAccount(true);
    try {
      await savePayoutAccount(sellerId, clean, accountName.trim());
      setIban(formatIban(clean));
      Alert.alert('Kaydedildi', 'Ödeme hesabın güncellendi.');
    } catch {
      Alert.alert('Kaydedilemedi', 'Lütfen tekrar dene.');
    } finally {
      setSavingAccount(false);
    }
  };

  const balance = summary?.open_balance_cents ?? 0;

  return (
    <View style={[st.safe, { backgroundColor: t.background }]}>
      <TopBar title="Kazancım" back />

      {loading && !failed ? (
        <View style={st.center}><ActivityIndicator color={t.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={st.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} colors={[t.primary]} />}
        >
          {failed && <Text style={[st.error, { color: t.danger }]}>Veriler yüklenemedi. Aşağı çekip yenile.</Text>}

          <View style={[st.balanceCard, { backgroundColor: t.brand }]}>
            <Text style={[st.balanceLabel, { color: t.onBrandSoft }]}>
              {balance > 0 ? 'Sana ödenecek' : balance < 0 ? 'Platforma ödenecek komisyon' : 'Açık bakiyen yok'}
            </Text>
            <Text style={[st.balanceValue, { color: balance > 0 ? t.accent : t.onBrand }]}>{priceTL(balance)}</Text>
            {!!summary?.open_order_count && (
              <Text style={[st.balanceSub, { color: t.onBrandSoft }]}>{summary.open_order_count} sipariş sonraki hesap kesiminde</Text>
            )}
            {!!summary?.held_count && (
              <Text style={[st.balanceSub, { color: t.onBrandSoft }]}>{summary.held_count} sipariş iade incelemesinde, sonuçlanınca eklenir</Text>
            )}
          </View>

          <View style={st.pillRow}>
            {PERIODS.map(([key, label]) => {
              const on = period === key;
              return (
                <Pressable
                  key={key}
                  style={[st.chip, { backgroundColor: on ? t.brand : t.surface }]}
                  hitSlop={2}
                  onPress={() => setPeriod(key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[st.chipText, { color: on ? t.onBrand : t.text }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={[st.card, { backgroundColor: t.surface }]}>
            <Text style={[st.cardTitle, { color: t.text }]}>{summary?.order_count ?? 0} teslim edilen sipariş</Text>
            <StatRow label="Satış ve teslimat" value={summary?.gross_cents ?? 0} />
            <StatRow label="Kampanya indirimlerin" value={summary?.seller_discount_cents ?? 0} minus />
            <StatRow label="Platform komisyonu" value={summary?.commission_cents ?? 0} minus />
            <StatRow label="Net kazanç" value={summary?.net_cents ?? 0} strong />
            <Text style={[st.hint, { color: t.textSecondary }]}>
              Nakit ve kapıda kartla {priceTL(summary?.collected_cents ?? 0)} doğrudan sana ödendi. Online ödemeler platforma gelir,
              hesap kesiminde sana aktarılır.
            </Text>
          </View>

          <View style={[st.card, { backgroundColor: t.surface }]}>
            <Text style={[st.cardTitle, { color: t.text }]}>Ödeme hesabı</Text>
            <Input
              label="IBAN"
              value={iban}
              onChangeText={setIban}
              placeholder="TR00 0000 0000 0000 0000 0000 00"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={34}
            />
            <Input
              label="Hesap sahibi"
              value={accountName}
              onChangeText={setAccountName}
              placeholder="Ad Soyad veya şirket unvanı"
              maxLength={100}
            />
            <Button
              label={savingAccount ? 'Kaydediliyor...' : 'Kaydet'}
              fullWidth
              onPress={saveAccount}
              disabled={savingAccount || !sellerId}
            />
          </View>

          <Text style={[st.sectionTitle, { color: t.heading }]}>Hesap kesimleri</Text>
          {payouts.length === 0 ? (
            <Text style={[st.emptyText, { color: t.textSecondary }]}>Henüz hesap kesimi yapılmadı.</Text>
          ) : (
            payouts.map(p => (
              <View key={p.id} style={[st.payoutRow, { backgroundColor: t.surface }]}>
                <View style={st.payoutBody}>
                  <Text style={[st.payoutTitle, { color: t.text }]}>{p.amount_cents >= 0 ? 'Sana ödendi' : 'Komisyon ödemen'}</Text>
                  <Text style={[st.payoutSub, { color: t.textSecondary }]}>
                    {new Date(p.created_at).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' })}
                    {' · '}{p.order_count} sipariş
                  </Text>
                  {!!p.note && <Text style={[st.payoutSub, { color: t.textSecondary }]}>{p.note}</Text>}
                </View>
                <Text style={[st.payoutAmount, { color: p.amount_cents < 0 ? t.text : t.success }]}>{priceTL(p.amount_cents)}</Text>
              </View>
            ))
          )}
          <View style={st.bottomSpace} />
        </ScrollView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 10 },
  bottomSpace: { height: 20 },
  error: { fontSize: 13, fontFamily: fonts.regular, textAlign: 'center' },

  balanceCard: { borderRadius: 16, padding: 14, gap: 4 },
  balanceLabel: { fontSize: 13, fontFamily: fonts.semibold },
  balanceValue: { fontSize: 30, lineHeight: 38, fontFamily: fonts.display, letterSpacing: -0.5 },
  balanceSub: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular },

  pillRow: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, height: 40, paddingHorizontal: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontFamily: fonts.bold },

  card: { borderRadius: 16, padding: 14, gap: 10 },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  statRowStrong: { borderTopWidth: 1, paddingTop: 10 },
  statLabel: { flex: 1, fontSize: 14, fontFamily: fonts.regular },
  statLabelStrong: { fontFamily: fonts.bold },
  statValue: { fontSize: 14, fontFamily: fonts.semibold },
  statValueStrong: { fontSize: 16, fontFamily: fonts.extrabold },
  hint: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular },

  sectionTitle: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4, marginTop: 8 },
  emptyText: { fontSize: 13, fontFamily: fonts.regular },
  payoutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 14 },
  payoutBody: { flex: 1, minWidth: 0, gap: 2 },
  payoutTitle: { fontSize: 14, fontFamily: fonts.bold },
  payoutSub: { fontSize: 12, fontFamily: fonts.regular },
  payoutAmount: { fontSize: 15, fontFamily: fonts.extrabold },
});
