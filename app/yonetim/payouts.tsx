import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  fetchMarketplaceEnabled,
  fetchMarketplaceSellers,
  fetchPaymentApprovalQueue,
  fetchPayoutOverview,
  fetchPayoutPolicy,
  fetchPendingPayouts,
  fetchPlatformTotals,
  markPayoutPaid,
  retryPaymentApproval,
  runWeeklySettlement,
  settleSeller,
  syncSubmerchant,
  updatePayoutPolicy,
  WEEKDAY_LABELS,
  type MarketplaceSellerRow,
  type PaymentApprovalRow,
  type PayoutOverviewRow,
  type PayoutPolicy,
  type PendingPayoutRow,
  type PlatformTotals,
} from '@/lib/db';
import { buildPayoutCsv, formatIban } from '@/lib/earnings';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';
import { LogoLoader } from '@/components/shared/Logo';

function priceTL(cents: number): string {
  return `₺${(Math.abs(cents) / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function shortDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long' }) : '';
}

const DELAY_OPTIONS = [0, 24, 48, 72];

function Chip({ label, on, onPress, st }: { label: string; on: boolean; onPress: () => void; st: ReturnType<typeof createStyles> }) {
  return (
    <Pressable
      onPress={onPress}
      style={[st.chip, on && st.chipOn]}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
    >
      <Text style={[st.chipText, on && st.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

/** Online ödemede iyzico onayının bekletilmesi ve haftalık otomatik kesim ayarı (054). */
function PolicySection({ st, policy, onSaved }: {
  st: ReturnType<typeof createStyles>;
  policy: PayoutPolicy;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(policy);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  useEffect(() => { setDraft(policy); }, [policy]);
  const changed = draft.approve_delay_hours !== policy.approve_delay_hours
    || draft.settlement_weekday !== policy.settlement_weekday
    || draft.auto_settlement !== policy.auto_settlement;

  const save = async () => {
    setSaving(true);
    try { await updatePayoutPolicy(draft); await onSaved(); }
    catch (e: any) { Alert.alert('Kaydedilemedi', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setSaving(false); }
  };
  const runNow = () => {
    Alert.alert('Kesimi şimdi çalıştır?', 'Bekletme süresi dolmuş son dönemin kesimi yapılır. Dönem zaten kesildiyse bir şey olmaz.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Çalıştır',
        onPress: async () => {
          setRunning(true);
          try {
            const r = await runWeeklySettlement();
            await onSaved();
            Alert.alert(r.skipped ? 'Bu dönem zaten kesildi' : 'Kesim yapıldı', r.skipped ? 'Yeni kesim gerekmedi.' : `${r.payouts ?? 0} restoran için kesim açıldı.`);
          } catch (e: any) { Alert.alert('Kesim yapılamadı', e?.message ?? 'Lütfen tekrar dene.'); }
          finally { setRunning(false); }
        },
      },
    ]);
  };

  return (
    <View style={st.card}>
      <Text style={st.name}>Ödeme takvimi</Text>
      <Text style={st.sub}>
        Online ödemede para, teslimden bu kadar saat sonra restorana geçmek üzere iyzico'ya onaylanır; iade talepleri bu sürede yakalanır.
      </Text>
      <View style={st.chipRow} accessibilityRole="radiogroup">
        {DELAY_OPTIONS.map(h => (
          <Chip key={h} st={st} label={h === 0 ? 'Hemen' : `${h} saat`} on={draft.approve_delay_hours === h} onPress={() => setDraft({ ...draft, approve_delay_hours: h })} />
        ))}
      </View>
      <Text style={st.sub}>
        Haftalık kesim seçilen günün 00:00'ına kadar teslim edilen siparişleri kapsar. Bekletme süresi bitince kendiliğinden yapılır; bekletme 24 saatse ertesi gün 06:00'da.
      </Text>
      <View style={st.chipRow} accessibilityRole="radiogroup">
        {WEEKDAY_LABELS.map((label, i) => (
          <Chip key={label} st={st} label={label} on={draft.settlement_weekday === i + 1} onPress={() => setDraft({ ...draft, settlement_weekday: i + 1 })} />
        ))}
      </View>
      <View style={st.chipRow} accessibilityRole="radiogroup">
        <Chip st={st} label="Otomatik kesim açık" on={draft.auto_settlement} onPress={() => setDraft({ ...draft, auto_settlement: true })} />
        <Chip st={st} label="Kapalı" on={!draft.auto_settlement} onPress={() => setDraft({ ...draft, auto_settlement: false })} />
      </View>
      <View style={st.policyActions}>
        <View style={st.modalBtn}>
          <Button label="Kesimi şimdi çalıştır" variant="outline" onPress={runNow} loading={running} fullWidth />
        </View>
        <View style={st.modalBtn}>
          <Button label="Kaydet" onPress={save} loading={saving} disabled={!changed} fullWidth />
        </View>
      </View>
    </View>
  );
}

/** Satıcıların iyzico kaydı ve parası iyzico'da bekleyen siparişler. Yalnızca anahtar açıkken görünür. */
function MarketplaceSection({ st, t }: { st: ReturnType<typeof createStyles>; t: ThemeColors }) {
  const [enabled, setEnabled] = useState(false);
  const [sellers, setSellers] = useState<MarketplaceSellerRow[]>([]);
  const [approvals, setApprovals] = useState<PaymentApprovalRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!(await fetchMarketplaceEnabled())) return;
    const [s, a] = await Promise.all([fetchMarketplaceSellers(), fetchPaymentApprovalQueue()]);
    setEnabled(true);
    setSellers(s);
    setApprovals(a);
  }, []);

  useEffect(() => { load().catch(() => setMessage('iyzico kayıtları yüklenemedi.')); }, [load]);

  if (!enabled) return null;

  const run = async (id: string, action: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(id);
    setMessage(null);
    try {
      await action();
      setMessage(done);
    } catch (e: any) {
      setMessage(e?.message ?? 'İşlem yapılamadı, tekrar dene.');
    } finally {
      await load().catch(() => undefined);
      setBusy(null);
    }
  };

  const statusOf = (s: MarketplaceSellerRow) => {
    if (s.has_key) return s.needs_sync ? 'Kayıtlı, bilgileri değişti: güncelle' : 'Kayıtlı';
    if (!s.has_company_info) return 'Şirket bilgisi eksik';
    if (!s.has_iban) return 'IBAN eksik';
    return s.status === 'error' ? 'Kayıt başarısız' : 'Kayıt bekliyor';
  };

  return (
    <>
      <Text style={st.sectionTitle}>Otomatik ödeme (iyzico)</Text>
      {message ? <Text style={st.sub}>{message}</Text> : null}

      {approvals.length > 0 && <Text style={st.sub}>Parası iyzico'da bekleyen teslim edilmiş siparişler</Text>}
      {approvals.map(a => (
        <View key={a.order_id} style={st.card}>
          <View style={st.cardTop}>
            <Text style={st.name} numberOfLines={1}>{a.display_name}</Text>
            <Text style={st.amount}>{priceTL(a.amount_cents ?? 0)}</Text>
          </View>
          <Text style={st.sub}>
            #{a.order_id.slice(0, 8)} · {a.status === 'failed'
              ? 'Onay başarısız'
              : a.due_at && new Date(a.due_at).getTime() > Date.now()
                ? `Onay ${dateTime(a.due_at)} sonrası gider`
                : 'Onay sırada'} · {a.attempts} deneme
            {a.refund_status === 'requested' ? ' · İade talebi açık, onay bekletiliyor' : ''}
          </Text>
          {a.last_error ? <Text style={st.noIban}>{a.last_error}</Text> : null}
          {a.status === 'failed' && (
            <View style={st.action}>
              <Button
                label={busy === a.order_id ? 'Bekle...' : 'Onayı yeniden dene'}
                variant="outline"
                disabled={!!busy}
                onPress={() => run(a.order_id, () => retryPaymentApproval(a.order_id), 'Onay yeniden sıraya alındı.')}
                fullWidth
              />
            </View>
          )}
        </View>
      ))}

      {sellers.map(s => (
        <View key={s.seller_id} style={st.card}>
          <Text style={st.name} numberOfLines={1}>{s.display_name}</Text>
          {s.legal_company_title ? <Text style={st.sub} numberOfLines={2}>{s.legal_company_title}</Text> : null}
          <Text style={s.has_key && !s.needs_sync ? st.ok : st.sub}>{statusOf(s)}</Text>
          {s.last_error ? <Text style={st.noIban}>{s.last_error}</Text> : null}
          {s.has_company_info && s.has_iban && (!s.has_key || s.needs_sync) && (
            <View style={st.action}>
              <Button
                label={busy === s.seller_id ? 'Gönderiliyor...' : s.has_key ? 'iyzico kaydını güncelle' : "iyzico'ya kaydet"}
                disabled={!!busy}
                onPress={() => run(s.seller_id, () => syncSubmerchant(s.seller_id), `${s.display_name}: iyzico kaydı tamam.`)}
                fullWidth
              />
            </View>
          )}
        </View>
      ))}
    </>
  );
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
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingPayoutRow[]>([]);
  const [policy, setPolicy] = useState<PayoutPolicy | null>(null);
  const [paying, setPaying] = useState<PendingPayoutRow | null>(null);
  const [reference, setReference] = useState('');

  const load = useCallback(async () => {
    try {
      const [r, t, p, pol] = await Promise.all([fetchPayoutOverview(), fetchPlatformTotals(), fetchPendingPayouts(), fetchPayoutPolicy()]);
      setRows(r);
      setTotals(t);
      setPending(p);
      setPolicy(pol);
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

  const confirmPaid = async () => {
    if (!paying || saving) return;
    setSaving(true);
    try {
      await markPayoutPaid(paying.id, paying.amount_cents, reference.trim() || undefined);
      setPaying(null);
      setReference('');
      await load();
    } catch (e: any) {
      if (e?.code === 'EVN04') {
        setPaying(null);
        Alert.alert('Tutar değişti', 'Bu kesimdeki bir siparişin iadesi onaylandı ve tutar düştü. Güncel tutarı kontrol et; fazla gönderdiysen farkı restorandan iste.');
        await load();
        return;
      }
      Alert.alert('Kaydedilemedi', e?.message ?? 'Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Havale listesi: ödeme bekleyen haftalık kesimlerden platformun borçlu olduğu restoranlar.
   * Web'de dosya iner, telefonda paylaşım ekranı açılır.
   */
  const exportPayoutList = async () => {
    const { csv, count, totalCents, missingIban } = buildPayoutCsv(pending.map(p => ({
      display_name: p.display_name, account_name: p.account_name, iban: p.iban,
      balance_cents: p.amount_cents, order_count: p.order_count,
    })));
    if (count === 0) {
      setExportNote('Ödeme bekleyen kesim yok.');
      return;
    }
    const summary = `${count} satıcı, toplam ${priceTL(totalCents)}${missingIban ? `. ${missingIban} satıcının IBAN'ı yok, listede boş görünür` : ''}.`;
    const fileName = `odeme-listesi-${new Date().toISOString().slice(0, 10)}.csv`;
    try {
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ title: fileName, message: csv });
      }
      setExportNote(summary);
    } catch {
      setExportNote('Liste paylaşılamadı, tekrar dene.');
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
        <View style={st.center}><LogoLoader /></View>
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

          {policy ? <PolicySection st={st} policy={policy} onSaved={load} /> : null}

          <Text style={st.sectionTitle}>Ödeme bekleyen kesimler</Text>
          <Text style={st.sub}>Haftalık kesimde açılır. Havaleyi yap (veya restorandan komisyonu al), sonra ödendi olarak işaretle; restorana bildirim gider.</Text>
          <Button label="Havale listesi (CSV)" variant="outline" onPress={exportPayoutList} fullWidth />
          {exportNote ? <Text style={st.sub}>{exportNote}</Text> : null}
          {pending.length === 0 && !failed && <Text style={st.empty}>Ödeme bekleyen kesim yok.</Text>}
          {pending.map(p => (
            <View key={p.id} style={st.card}>
              <View style={st.cardTop}>
                <Text style={st.name} numberOfLines={1}>{p.display_name}</Text>
                <Text style={st.amount}>{priceTL(p.amount_cents)}</Text>
              </View>
              <Text style={st.sub}>
                {p.amount_cents > 0 ? 'Restorana ödenecek' : 'Restorandan alınacak komisyon'}
                {' · '}{p.order_count} sipariş{p.period_end ? ` · ${shortDate(p.period_start)} – ${shortDate(p.period_end)}` : ''}
              </Text>
              {p.amount_cents > 0 ? (p.iban ? (
                <Pressable
                  style={st.ibanRow}
                  onPress={() => copyIban(p.iban!)}
                  accessibilityRole="button"
                  accessibilityLabel={`IBAN'ı kopyala: ${p.account_name}, ${formatIban(p.iban)}`}
                >
                  <Text style={st.iban}>{p.account_name} · {formatIban(p.iban)}</Text>
                  <Ionicons name="copy-outline" size={16} color={t.textSecondary} />
                </Pressable>
              ) : <Text style={st.noIban}>Restoran IBAN girmedi</Text>) : null}
              <View style={st.action}>
                <Button
                  label={p.amount_cents > 0 ? 'Havale yapıldı' : 'Komisyon alındı'}
                  onPress={() => { setReference(''); setPaying(p); }}
                  fullWidth
                />
              </View>
            </View>
          ))}

          <Text style={st.sectionTitle}>Henüz kesilmemiş bakiyeler</Text>
          <Text style={st.sub}>Bir sonraki haftalık kesime girecek tutarlar. Beklemeden ödemen gerekirse buradan elle kesebilirsin.</Text>
          {rows.length === 0 && !failed && <Text style={st.empty}>Kesilmemiş bakiye yok.</Text>}

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
          <MarketplaceSection st={st} t={t} />
          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      <Modal visible={!!paying} transparent animationType="fade" onRequestClose={() => setPaying(null)}>
        <View style={st.modalBg}>
          <View style={st.modalCard}>
            <Text style={st.modalTitle}>{paying?.display_name}</Text>
            <Text style={st.modalText}>
              {paying && paying.amount_cents > 0
                ? `${priceTL(paying.amount_cents)} restorana gönderildi olarak işaretlenecek.`
                : paying ? `${priceTL(paying.amount_cents)} komisyon restorandan alındı olarak işaretlenecek.` : ''}
            </Text>
            <Text style={st.modalHint}>Bu işlem parayı göndermez. Havale gerçekten yapıldıktan sonra işaretle; geri alınamaz.</Text>
            <Input
              value={reference}
              onChangeText={setReference}
              placeholder="Havale referansı (isteğe bağlı)"
              accessibilityLabel="Havale referansı"
              maxLength={200}
            />
            <View style={st.modalBtns}>
              <View style={st.modalBtn}>
                <Button label="Vazgeç" variant="outline" onPress={() => setPaying(null)} disabled={saving} fullWidth />
              </View>
              <View style={st.modalBtn}>
                <Button label={saving ? 'Kaydediliyor...' : 'İşaretle'} onPress={confirmPaid} disabled={saving} fullWidth />
              </View>
            </View>
          </View>
        </View>
      </Modal>

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
  ok: { fontSize: 12, fontFamily: fonts.semibold, color: t.success },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4, color: t.heading, marginTop: 8 },
  action: { marginTop: 4 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: t.surface, borderRadius: 16, padding: 20, gap: 10 },
  modalTitle: { fontSize: 19, fontFamily: fonts.display, letterSpacing: -0.3, color: t.heading },
  modalText: { fontFamily: fonts.regular, fontSize: 14, color: t.text, lineHeight: 20 },
  modalHint: { fontFamily: fonts.semibold, fontSize: 12, color: t.textSecondary, lineHeight: 17 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalBtn: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center', backgroundColor: t.background },
  chipOn: { backgroundColor: t.accent },
  chipText: { fontSize: 13, fontFamily: fonts.semibold, color: t.text },
  chipTextOn: { color: t.onAccent },
  policyActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
