import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { fetchPayoutOverview, fetchPlatformTotals, settleSeller, type PayoutOverviewRow, type PlatformTotals } from '@/lib/db';
import { formatIban } from '@/lib/earnings';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

function priceTL(cents: number): string {
  return `₺${(Math.abs(cents) / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AdminPayoutsScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const [rows, setRows] = useState<PayoutOverviewRow[]>([]);
  const [totals, setTotals] = useState<PlatformTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [settling, setSettling] = useState<PayoutOverviewRow | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([fetchPayoutOverview(), fetchPlatformTotals()]);
      setRows(r);
      setTotals(t);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const confirmSettle = async () => {
    if (!settling || saving) return;
    setSaving(true);
    try {
      await settleSeller(settling.seller_id, settling.balance_cents, note);
      setSettling(null);
      setNote('');
      await load();
    } catch (e: any) {
      if (e?.code === 'EVN04') {
        setSettling(null);
        Alert.alert('Bakiye değişti', 'Bu arada yeni sipariş veya iade oldu. Güncel tutarı kontrol edip tekrar dene.');
        await load();
      } else {
        Alert.alert('Kaydedilemedi', e?.code === '55000' ? e.message : 'Lütfen tekrar dene.');
      }
    } finally {
      setSaving(false);
    }
  };

  const copyIban = async (iban: string) => {
    await Clipboard.setStringAsync(iban).catch(() => undefined);
    Alert.alert('Kopyalandı', formatIban(iban));
  };

  return (
    <View style={st.safe}>
      <TopBar title="Satıcı ödemeleri" back />

      {loading ? (
        <View style={st.center}><ActivityIndicator color={t.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={st.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
        >
          {failed && <Text style={st.error}>Veriler yüklenemedi. Aşağı çekip yenile.</Text>}

          <View style={st.totals}>
            <View style={st.totalCard}>
              <Text style={st.totalValue} numberOfLines={1} adjustsFontSizeToFit>{priceTL(totals?.sales_cents ?? 0)}</Text>
              <Text style={st.totalLabel}>Teslim edilen satış</Text>
              <Text style={st.totalSub}>{totals?.delivered_count ?? 0} sipariş</Text>
            </View>
            <View style={st.totalCard}>
              <Text style={st.totalValue} numberOfLines={1} adjustsFontSizeToFit>{priceTL(totals?.commission_cents ?? 0)}</Text>
              <Text style={st.totalLabel}>Toplam komisyon</Text>
            </View>
            <View style={st.totalCard}>
              <Text style={st.totalValue} numberOfLines={1} adjustsFontSizeToFit>{priceTL(totals?.payable_cents ?? 0)}</Text>
              <Text style={st.totalLabel}>Satıcılara ödenecek</Text>
            </View>
            <View style={st.totalCard}>
              <Text style={st.totalValue} numberOfLines={1} adjustsFontSizeToFit>{priceTL(totals?.receivable_cents ?? 0)}</Text>
              <Text style={st.totalLabel}>Satıcılardan alınacak</Text>
            </View>
          </View>

          {rows.length === 0 && !failed && <Text style={st.empty}>Bekleyen hesap kesimi yok.</Text>}

          {rows.map(r => (
            <View key={r.seller_id} style={st.card}>
              <View style={st.cardTop}>
                <Text style={st.name} numberOfLines={1}>{r.display_name}</Text>
                <Text style={st.amount}>{priceTL(r.balance_cents)}</Text>
              </View>
              <Text style={st.sub}>
                {r.balance_cents > 0 ? 'Satıcıya ödenecek' : r.balance_cents < 0 ? 'Satıcıdan alınacak' : 'Bakiye sıfır'}
                {' · '}{r.order_count} sipariş · Komisyon {priceTL(r.commission_cents)}
              </Text>
              {r.held_count > 0 && <Text style={st.sub}>{r.held_count} sipariş iade incelemesinde, kesime girmez</Text>}
              {r.iban ? (
                <Pressable
                  style={st.ibanRow}
                  onPress={() => copyIban(r.iban!)}
                  accessibilityRole="button"
                  accessibilityLabel={`IBAN'ı kopyala: ${r.account_name}, ${formatIban(r.iban)}`}
                >
                  <Text style={st.iban}>{r.account_name} · {formatIban(r.iban)}</Text>
                  <Ionicons name="copy-outline" size={16} color={t.textSecondary} />
                </Pressable>
              ) : (
                <Text style={st.noIban}>Satıcı IBAN girmedi</Text>
              )}
              {r.last_payout_at && (
                <Text style={st.sub}>Son kesim: {new Date(r.last_payout_at).toLocaleDateString('tr-TR')}</Text>
              )}
              {r.order_count > 0 && (
                <View style={st.action}>
                  <Button label="Hesap kesimini kaydet" onPress={() => { setNote(''); setSettling(r); }} fullWidth />
                </View>
              )}
            </View>
          ))}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      <Modal visible={!!settling} transparent animationType="fade" onRequestClose={() => setSettling(null)}>
        <View style={st.modalBg}>
          <View style={st.modalCard}>
            <Text style={st.modalTitle}>{settling?.display_name}</Text>
            <Text style={st.modalText}>
              {settling && settling.balance_cents > 0 && `${priceTL(settling.balance_cents)} satıcıya gönderildi olarak kaydedilecek.`}
              {settling && settling.balance_cents < 0 && `${priceTL(settling.balance_cents)} satıcıdan alındı olarak kaydedilecek.`}
              {settling && settling.balance_cents === 0 && 'Bakiye sıfır, siparişler kapatılacak.'}
            </Text>
            <Text style={st.modalHint}>Bu işlem parayı göndermez. Havaleyi yaptıktan sonra kaydet; geri alınamaz.</Text>
            <Input
              value={note}
              onChangeText={setNote}
              placeholder="Not (örn. havale referansı)"
              accessibilityLabel="Not"
              maxLength={300}
            />
            <View style={st.modalBtns}>
              <View style={st.modalBtn}>
                <Button label="Vazgeç" variant="outline" onPress={() => setSettling(null)} disabled={saving} fullWidth />
              </View>
              <View style={st.modalBtn}>
                <Button label={saving ? 'Kaydediliyor...' : 'Kaydet'} onPress={confirmSettle} disabled={saving} fullWidth />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 10 },
  error: { fontFamily: fonts.semibold, fontSize: 13, color: t.danger, textAlign: 'center' },
  empty: { fontFamily: fonts.regular, fontSize: 14, color: t.textSecondary, textAlign: 'center', marginTop: 16 },
  totals: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  totalCard: { flexGrow: 1, flexBasis: '46%', minWidth: 0, backgroundColor: t.surface, borderRadius: 16, padding: 14 },
  totalValue: { fontSize: 24, fontFamily: fonts.display, color: t.text },
  totalLabel: { fontSize: 12, fontFamily: fonts.regular, color: t.textSecondary, marginTop: 2 },
  totalSub: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary },
  card: { backgroundColor: t.surface, borderRadius: 16, padding: 14, gap: 6 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  name: { fontSize: 15, fontFamily: fonts.bold, color: t.text, flex: 1 },
  amount: { fontSize: 16, fontFamily: fonts.extrabold, color: t.text },
  sub: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary },
  ibanRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  iban: { flex: 1, fontSize: 12, fontFamily: fonts.semibold, color: t.text },
  noIban: { fontSize: 12, fontFamily: fonts.semibold, color: t.danger },
  action: { marginTop: 4 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: t.surface, borderRadius: 16, padding: 20, gap: 10 },
  modalTitle: { fontSize: 19, fontFamily: fonts.display, letterSpacing: -0.3, color: t.heading },
  modalText: { fontFamily: fonts.regular, fontSize: 14, color: t.text, lineHeight: 20 },
  modalHint: { fontFamily: fonts.semibold, fontSize: 12, color: t.textSecondary, lineHeight: 17 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalBtn: { flex: 1 },
});
