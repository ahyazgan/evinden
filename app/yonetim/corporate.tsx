import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TopBar } from '@/components/shared/TopBar';
import { LogoLoader } from '@/components/shared/Logo';
import { Button } from '@/components/ui/Button';
import { EmptyState, SegmentedControl, StatusPill } from '@/components/ui/Enterprise';
import { moneyTL } from '@/lib/enterprise-format';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';
import { adminSetCorporateStatus, CORPORATE_STATUS_TEXT, fetchAdminCorporateWorkspaces, type AdminCorporateRow, type CorporateStatus } from '@/lib/corporate';

type Filter = 'pending' | 'active' | 'suspended' | 'all';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'pending', label: 'Bekleyen' },
  { value: 'active', label: 'Etkin' },
  { value: 'suspended', label: 'Askıda' },
  { value: 'all', label: 'Tümü' },
];
const VARIANT: Record<CorporateStatus, 'amber' | 'success' | 'danger'> = { pending: 'amber', active: 'success', suspended: 'danger' };

/** Yönetici: kurumsal hesap talepleri (060). Onayda katılım kodu oluşur, askıya alınan hesapla şirket siparişi verilemez. */
export default function AdminCorporateScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const [rows, setRows] = useState<AdminCorporateRow[]>([]);
  const [filter, setFilter] = useState<Filter>('pending');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const data = await fetchAdminCorporateWorkspaces();
      if (mine !== seq.current) return;
      setRows(data);
      setFailed(false);
    } catch {
      if (mine === seq.current) setFailed(true);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const decide = (row: AdminCorporateRow, approve: boolean) => {
    const title = approve ? (row.status === 'suspended' ? 'Yeniden etkinleştir' : 'Onayla') : 'Askıya al';
    const body = approve
      ? `${row.name} etkin olur, ${row.owner_name} katılım kodunu görür ve çalışanlar şirket siparişi verebilir.`
      : `${row.name} ile şirket siparişi verilemez. Üyeler ve geçmiş siparişler korunur.`;
    Alert.alert(title, body, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: title,
        style: approve ? 'default' : 'destructive',
        onPress: async () => {
          setBusy(row.id);
          try { await adminSetCorporateStatus(row.id, approve); await load(); }
          catch (e: any) { Alert.alert('İşlem yapılamadı', e?.message ?? 'Lütfen tekrar dene.'); }
          finally { setBusy(null); }
        },
      },
    ]);
  };

  const visible = rows.filter(r => filter === 'all' || r.status === filter);
  const pendingCount = rows.filter(r => r.status === 'pending').length;

  return (
    <View style={st.safe}>
      <TopBar title="Kurumsal hesaplar" subtitle={pendingCount ? `${pendingCount} talep bekliyor` : 'Bekleyen talep yok'} back />
      <View style={st.filters}>
        <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} />
      </View>
      {loading ? <View style={st.center}><LogoLoader /></View> : (
        <ScrollView
          contentContainerStyle={st.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        >
          {failed ? (
            <EmptyState title="Liste alınamadı" description="Bağlantını kontrol edip tekrar dene." icon="cloud-offline-outline" actionLabel="Tekrar dene" onAction={() => { setLoading(true); void load(); }} />
          ) : visible.length === 0 ? (
            <EmptyState title="Kayıt yok" description={filter === 'pending' ? 'Onay bekleyen kurumsal hesap talebi yok.' : 'Bu durumda kurumsal hesap yok.'} icon="briefcase-outline" />
          ) : visible.map(row => (
            <View key={row.id} style={[st.card, { backgroundColor: t.surface }]}>
              <View style={st.head}>
                <Text style={st.title}>{row.name}</Text>
                <StatusPill label={CORPORATE_STATUS_TEXT[row.status]} variant={VARIANT[row.status]} />
              </View>
              <Text style={st.sub}>Talep eden: {row.owner_name} · {new Date(row.created_at).toLocaleDateString('tr-TR')}</Text>
              <Text style={st.sub}>
                Aylık bütçe: {row.monthly_budget_cents == null ? 'sınır yok' : moneyTL(row.monthly_budget_cents)}
                {row.status !== 'pending' ? ` · ${row.member_count} üye · bu ay ${moneyTL(row.month_spent_cents)}` : ''}
              </Text>
              <View style={st.row}>
                {row.status !== 'active' ? (
                  <View style={st.flex}>
                    <Button label={row.status === 'suspended' ? 'Yeniden etkinleştir' : 'Onayla'} fullWidth size="sm" loading={busy === row.id} disabled={!!busy} onPress={() => decide(row, true)} />
                  </View>
                ) : null}
                {row.status !== 'suspended' ? (
                  <View style={st.flex}>
                    <Button label={row.status === 'pending' ? 'Reddet' : 'Askıya al'} variant="outline" fullWidth size="sm" disabled={!!busy} onPress={() => decide(row, false)} />
                  </View>
                ) : null}
              </View>
            </View>
          ))}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  filters: { paddingHorizontal: 16, paddingTop: 8 },
  list: { padding: 16, gap: 10 },
  card: { borderRadius: 16, padding: 14, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: t.text },
  sub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: t.textSecondary },
  row: { flexDirection: 'row', gap: 8, marginTop: 4 },
  flex: { flex: 1, minWidth: 0 },
});
