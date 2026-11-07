import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { EmptyState, MetricCard, SegmentedControl, StatusPill, ToolbarSearch } from '@/components/ui/Enterprise';
import { LogoLoader } from '@/components/shared/Logo';
import { EvidencePhotos } from '@/components/shared/EvidencePhotos';
import { fetchRefundEvidence } from '@/lib/db';
import { decideRefundCase, fetchRefundCases, markRefundCasePaid, type RefundCaseRow } from '@/lib/enterprise';
import { enterpriseStatus, PAYMENT_METHOD_LABELS, REFUND_STATUS } from '@/lib/enterprise-status';
import { moneyTL, dateTR } from '@/lib/enterprise-format';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

type Filter = 'requested' | 'approved' | 'paid' | 'rejected' | 'all';
const NO_PHOTOS: string[] = [];
type Decision = 'approved' | 'rejected';

export default function AdminRefundsScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const { status: statusParam } = useLocalSearchParams<{ status?: string }>();
  const [rows, setRows] = useState<RefundCaseRow[]>([]);
  const [filter, setFilter] = useState<Filter>(statusParam === 'approved' || statusParam === 'paid' || statusParam === 'rejected' || statusParam === 'all' ? statusParam : 'requested');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ row: RefundCaseRow; decision: Decision } | null>(null);
  const [payConfirm, setPayConfirm] = useState<RefundCaseRow | null>(null);

  const [evidence, setEvidence] = useState<Map<string, string[]>>(new Map());
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const next = await fetchRefundCases(filter === 'all' ? null : filter);
      if (seq !== loadSeq.current) return;
      setRows(next);
      // Fotoğraflar ayrı okunur; okunamazsa liste yine gösterilir. Eski filtrenin yanıtı yenisini ezmez.
      fetchRefundEvidence([...new Set(next.map(r => r.order_id))])
        .then(map => { if (seq === loadSeq.current) setEvidence(map); })
        .catch(() => undefined);
    }
    catch (e: any) { Alert.alert('İadeler alınamadı', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { setLoading(true); void load(); }, [load]);
  useEffect(() => { setFilter(statusParam === 'approved' || statusParam === 'paid' || statusParam === 'rejected' || statusParam === 'all' ? statusParam : 'requested'); }, [statusParam]);
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);
  const visible = rows.filter(row => `${row.customer_name} ${row.seller_name} ${row.order_id} ${row.reason}`.toLocaleLowerCase('tr-TR').includes(search.toLocaleLowerCase('tr-TR')));
  const pendingAmount = rows.filter(r => r.status === 'requested').reduce((sum, r) => sum + r.requested_cents, 0);

  const decide = async () => {
    if (!confirm) return;
    const { row, decision } = confirm; setConfirm(null); setBusy(row.id);
    try { await decideRefundCase(row.id, decision, row.requested_cents, decision === 'approved' ? 'Yönetici onayı' : 'Yönetici reddi'); await load(); }
    catch (e: any) { Alert.alert('Karar kaydedilemedi', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setBusy(null); }
  };
  const markPaid = async () => {
    if (!payConfirm) return;
    const row = payConfirm; setPayConfirm(null); setBusy(row.id);
    try { await markRefundCasePaid(row.id); await load(); }
    catch (e: any) { Alert.alert('İade tamamlanamadı', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setBusy(null); }
  };

  return (
    <View style={st.safe}>
      <TopBar title="İade karar merkezi" subtitle="Talep, onay ve iade geçmişi" back />
      {loading ? <View style={st.center}><LogoLoader /></View> : <ScrollView contentContainerStyle={st.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.primary} />}>
        <View style={st.metrics}>
          <MetricCard label="Bekleyen talep" value={String(rows.filter(r => r.status === 'requested').length)} icon="time-outline" variant={rows.some(r => r.status === 'requested') ? 'warning' : 'accent'} />
          <MetricCard label="Bekleyen tutar" value={moneyTL(pendingAmount, true)} icon="cash-outline" />
        </View>
        <SegmentedControl options={[{ value: 'requested', label: 'Bekleyen' }, { value: 'approved', label: 'Onaylı' }, { value: 'paid', label: 'İade edilen' }, { value: 'rejected', label: 'Reddedilen' }, { value: 'all', label: 'Tümü' }]} value={filter} onChange={setFilter} />
        <ToolbarSearch value={search} onChangeText={setSearch} placeholder="Müşteri, satıcı veya sipariş ara" />
        {visible.length === 0 ? <EmptyState title="İade kaydı yok" description="Seçili filtrede uygun bir iade vakası bulunmuyor." icon="arrow-undo-outline" /> : visible.map(row => {
          const status = enterpriseStatus(REFUND_STATUS, row.status);
          return <View key={row.id} style={[st.card, { backgroundColor: t.surface }]}>
            <View style={st.rowHead}><Text style={[st.title, { color: t.text }]} numberOfLines={1}>{row.customer_name} · {row.seller_name}</Text><StatusPill label={status.label} variant={status.variant} /></View>
            <Text style={[st.meta, { color: t.textSecondary }]}>#{row.order_id.slice(0, 8)} · {PAYMENT_METHOD_LABELS[row.payment_method] ?? row.payment_method} · {moneyTL(row.requested_cents)}</Text>
            <Text style={[st.reason, { color: t.text }]}>“{row.reason}”</Text>
            <EvidencePhotos paths={evidence.get(row.order_id) ?? NO_PHOTOS} />
            <View style={[st.timeline, { backgroundColor: t.background }]}>
              <TimelineStep label="Talep oluşturuldu" time={row.requested_at} done />
              <TimelineStep label="Yönetici kararı" time={row.decided_at} done={row.status !== 'requested'} active={row.status === 'requested'} />
              <TimelineStep label="İade tamamlandı" time={row.paid_at} done={row.status === 'paid'} last />
            </View>
            {row.decision_note ? <Text style={[st.meta, { color: t.textMuted }]}>Not: {row.decision_note}</Text> : null}
            {row.status === 'requested' ? <View style={st.actions}><Button label="Reddet" variant="danger" size="sm" onPress={() => setConfirm({ row, decision: 'rejected' })} /><Button label="Onayla" size="sm" loading={busy === row.id} onPress={() => setConfirm({ row, decision: 'approved' })} /></View> : null}
            {row.status === 'approved' && row.payment_method !== 'online' ? <Button label="Kapıda iadeyi tamamla" variant="outline" size="sm" onPress={() => setPayConfirm(row)} /> : null}
            {row.status === 'approved' && row.payment_method === 'online' ? <Text style={[st.meta, { color: t.textSecondary }]}>Bu iade iyzico üzerinden tamamlanacak.</Text> : null}
          </View>;
        })}
        <View style={{ height: 32 }} />
      </ScrollView>}
      <ConfirmModal visible={!!confirm} title={confirm?.decision === 'approved' ? 'İadeyi onayla' : 'İade talebini reddet'} body={confirm ? `${confirm.row.customer_name} için ${moneyTL(confirm.row.requested_cents)} tutarındaki iade talebi ${confirm.decision === 'approved' ? 'onaylanacak' : 'reddedilecek'}.` : ''} confirmLabel={confirm?.decision === 'approved' ? 'Onayla' : 'Reddet'} danger={confirm?.decision === 'rejected'} onCancel={() => setConfirm(null)} onConfirm={decide} />
      <ConfirmModal visible={!!payConfirm} title="Kapıda iadeyi tamamla" body={payConfirm ? `${moneyTL(payConfirm.requested_cents)} tutarın müşteriye geri verildiğini onaylıyor musun? Bu işlem geri alınamaz.` : ''} confirmLabel="Tamamlandı" onCancel={() => setPayConfirm(null)} onConfirm={markPaid} />
    </View>
  );
}



function TimelineStep({ label, time, done, active, last }: { label: string; time: string | null; done?: boolean; active?: boolean; last?: boolean }) {
  const { colors: t } = useTheme();
  const st = createStyles(t);
  return <View style={st.step}><View style={[st.dot, { backgroundColor: done ? t.success : active ? t.amber : t.divider }]} /><View style={st.stepCopy}><Text style={[st.stepLabel, { color: t.text }]}>{label}</Text><Text style={[st.meta, { color: t.textSecondary }]}>{time ? dateTR(time, true) : active ? 'Bekliyor' : 'Henüz olmadı'}</Text></View>{!last ? <View style={[st.line, { backgroundColor: t.divider }]} /> : null}</View>;
}

function ConfirmModal({ visible, title, body, confirmLabel, danger, onCancel, onConfirm }: { visible: boolean; title: string; body: string; confirmLabel: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { colors: t } = useTheme();
  const st = createStyles(t);
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}><View style={st.modalBack}><View style={[st.modal, { backgroundColor: t.surface }]}><Text accessibilityRole="header" style={[st.modalTitle, { color: t.heading }]}>{title}</Text><Text style={[st.modalBody, { color: t.textSecondary }]}>{body}</Text><View style={st.modalActions}><Button label="Vazgeç" variant="outline" onPress={onCancel} /><Button label={confirmLabel} variant={danger ? 'danger' : 'primary'} onPress={onConfirm} /></View></View></View></Modal>;
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, list: { padding: 16, gap: 12 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, card: { borderRadius: 16, padding: 14, gap: 9 }, rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { flex: 1, fontSize: 15, fontFamily: fonts.bold, color: t.text }, meta: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular }, reason: { fontSize: 14, lineHeight: 20, fontFamily: fonts.semibold },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, timeline: { borderRadius: 12, padding: 12, gap: 10 }, step: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, minHeight: 38 },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 4 }, stepCopy: { flex: 1 }, stepLabel: { fontSize: 13, fontFamily: fonts.semibold }, line: { position: 'absolute', left: 4, top: 14, bottom: -10, width: 1 },
  modalBack: { flex: 1, backgroundColor: 'rgba(21,26,22,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 }, modal: { width: '100%', maxWidth: 460, borderRadius: 18, padding: 20, gap: 12 },
  modalTitle: { fontSize: 20, fontFamily: fonts.display }, modalBody: { fontSize: 14, lineHeight: 21, fontFamily: fonts.regular }, modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
});
