import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { colors } from '@/constants/theme';
import { fetchPayoutOverview, fetchPlatformTotals, settleSeller, type PayoutOverviewRow, type PlatformTotals } from '@/lib/db';
import { formatIban } from '@/lib/earnings';
import { fonts } from '@/lib/fonts';

function priceTL(cents: number): string {
  return `₺${(Math.abs(cents) / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AdminPayoutsScreen() {
  const router = useRouter();
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
        Alert.alert('Bakiye değişti', 'Bu arada yeni sipariş veya iade oldu. Güncel tutarı kontrol edip tekrar deneyin.');
        await load();
      } else {
        Alert.alert('Kaydedilemedi', e?.code === '55000' ? e.message : 'Lütfen tekrar deneyin.');
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
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <Text style={st.headerTitle}>Satıcı Ödemeleri</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={st.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={st.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {failed && <Text style={st.error}>Veriler yüklenemedi. Aşağı çekip yenileyin.</Text>}

          <View style={st.totals}>
            <View style={st.totalCard}>
              <Text style={st.totalLabel}>Teslim edilen satış</Text>
              <Text style={st.totalValue}>{priceTL(totals?.sales_cents ?? 0)}</Text>
              <Text style={st.totalSub}>{totals?.delivered_count ?? 0} sipariş</Text>
            </View>
            <View style={st.totalCard}>
              <Text style={st.totalLabel}>Toplam komisyon</Text>
              <Text style={st.totalValue}>{priceTL(totals?.commission_cents ?? 0)}</Text>
            </View>
            <View style={st.totalCard}>
              <Text style={st.totalLabel}>Satıcılara ödenecek</Text>
              <Text style={[st.totalValue, st.payable]}>{priceTL(totals?.payable_cents ?? 0)}</Text>
            </View>
            <View style={st.totalCard}>
              <Text style={st.totalLabel}>Satıcılardan alınacak</Text>
              <Text style={[st.totalValue, st.receivable]}>{priceTL(totals?.receivable_cents ?? 0)}</Text>
            </View>
          </View>

          {rows.length === 0 && !failed && <Text style={st.empty}>Bekleyen hesap kesimi yok.</Text>}

          {rows.map(r => (
            <View key={r.seller_id} style={st.card}>
              <View style={st.cardTop}>
                <Text style={st.name} numberOfLines={1}>{r.display_name}</Text>
                <Text style={[st.amount, r.balance_cents > 0 ? st.payable : st.receivable]}>{priceTL(r.balance_cents)}</Text>
              </View>
              <Text style={st.sub}>
                {r.balance_cents > 0 ? 'Satıcıya ödenecek' : r.balance_cents < 0 ? 'Satıcıdan alınacak' : 'Bakiye sıfır'}
                {' · '}{r.order_count} sipariş · Komisyon {priceTL(r.commission_cents)}
              </Text>
              {r.held_count > 0 && <Text style={st.sub}>{r.held_count} sipariş iade incelemesinde, kesime girmez</Text>}
              {r.iban ? (
                <Pressable onPress={() => copyIban(r.iban!)}>
                  <Text style={st.iban}>{r.account_name} · {formatIban(r.iban)}</Text>
                </Pressable>
              ) : (
                <Text style={st.noIban}>Satıcı IBAN girmedi</Text>
              )}
              {r.last_payout_at && (
                <Text style={st.sub}>Son kesim: {new Date(r.last_payout_at).toLocaleDateString('tr-TR')}</Text>
              )}
              {r.order_count > 0 && (
                <Pressable style={st.settleBtn} onPress={() => { setNote(''); setSettling(r); }}>
                  <Text style={st.settleText}>Hesap kesimini kaydet</Text>
                </Pressable>
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
            <Text style={st.modalHint}>Bu işlem parayı göndermez. Havaleyi yaptıktan sonra kaydedin; geri alınamaz.</Text>
            <TextInput
              style={st.input}
              value={note}
              onChangeText={setNote}
              placeholder="Not (örn. havale referansı)"
              placeholderTextColor="#6B766F"
              maxLength={300}
            />
            <View style={st.modalBtns}>
              <Pressable style={st.modalCancel} onPress={() => setSettling(null)} disabled={saving}>
                <Text style={st.modalCancelText}>Vazgeç</Text>
              </Pressable>
              <Pressable style={[st.modalSave, saving && st.disabled]} onPress={confirmSettle} disabled={saving}>
                <Text style={st.modalSaveText}>{saving ? 'Kaydediliyor...' : 'Kaydet'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#17402F' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1F2B24', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontFamily: fonts.display, color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 12 },
  error: { fontFamily: fonts.regular, fontSize: 13, color: '#EF9A9A', textAlign: 'center' },
  empty: { fontFamily: fonts.regular, fontSize: 14, color: '#6B766F', textAlign: 'center', marginTop: 16 },
  totals: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  totalCard: { flexGrow: 1, flexBasis: '46%', backgroundColor: '#1F2B24', borderRadius: 14, padding: 14, gap: 2 },
  totalLabel: { fontSize: 11, fontFamily: fonts.semibold, color: '#6B766F' },
  totalValue: { fontSize: 17, fontFamily: fonts.extrabold, color: '#fff' },
  totalSub: { fontFamily: fonts.regular, fontSize: 11, color: '#6B766F' },
  payable: { color: '#81C784' },
  receivable: { color: '#FFB74D' },
  card: { backgroundColor: '#1F2B24', borderRadius: 14, padding: 14, gap: 6 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  name: { fontSize: 15, fontFamily: fonts.bold, color: '#fff', flex: 1 },
  amount: { fontSize: 16, fontFamily: fonts.extrabold },
  sub: { fontFamily: fonts.regular, fontSize: 12, color: '#A3ACA5' },
  iban: { fontSize: 12, fontFamily: fonts.semibold, color: '#90CAF9' },
  noIban: { fontSize: 12, fontFamily: fonts.semibold, color: '#EF9A9A' },
  settleBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  settleText: { color: '#fff', fontSize: 13, fontFamily: fonts.bold },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#1F2B24', borderRadius: 18, padding: 20, gap: 10 },
  modalTitle: { fontSize: 17, fontFamily: fonts.extrabold, color: '#fff' },
  modalText: { fontFamily: fonts.regular, fontSize: 14, color: '#fff', lineHeight: 20 },
  modalHint: { fontFamily: fonts.regular, fontSize: 12, color: '#FFB74D', lineHeight: 17 },
  input: { backgroundColor: '#17402F', borderRadius: 10, padding: 12, fontFamily: fonts.regular, fontSize: 14, color: '#fff' },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#17402F' },
  modalCancelText: { fontSize: 14, fontFamily: fonts.semibold, color: '#A3ACA5' },
  modalSave: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: colors.primary },
  modalSaveText: { fontSize: 14, fontFamily: fonts.bold, color: '#fff' },
  disabled: { opacity: 0.5 },
});
