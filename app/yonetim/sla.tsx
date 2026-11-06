import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { EmptyState, MetricCard, SectionHeader, SegmentedControl, StatusPill } from '@/components/ui/Enterprise';
import { LogoLoader } from '@/components/shared/Logo';
import { SlaPolicyEditor } from '@/components/enterprise/SlaPolicyEditor';
import { fetchSlaPolicy, fetchSlaViolations, resolveSlaViolation, updateSlaPolicy, type SlaPolicy, type SlaViolationRow } from '@/lib/enterprise';
import { enterpriseStatus, SLA_STATUS } from '@/lib/enterprise-status';
import { moneyTL, dateTR } from '@/lib/enterprise-format';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

type Filter = 'open' | 'waived' | 'collected';

export default function AdminSlaScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const { status: statusParam } = useLocalSearchParams<{ status?: string }>();
  const [policy, setPolicy] = useState<SlaPolicy | null>(null);
  const [saved, setSaved] = useState<SlaPolicy | null>(null);
  const [rows, setRows] = useState<SlaViolationRow[]>([]);
  const [filter, setFilter] = useState<Filter>(statusParam === 'waived' || statusParam === 'collected' ? statusParam : 'open');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, v] = await Promise.all([fetchSlaPolicy(), fetchSlaViolations(filter)]);
      setPolicy(p); setSaved(p); setRows(v);
    } catch (e: any) {
      Alert.alert('SLA verileri alınamadı', e?.message ?? 'Lütfen tekrar dene.');
    } finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { setLoading(true); void load(); }, [load]);
  useEffect(() => { setFilter(statusParam === 'waived' || statusParam === 'collected' ? statusParam : 'open'); }, [statusParam]);
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);
  const dirty = !!policy && !!saved && JSON.stringify(policy) !== JSON.stringify(saved);
  const save = async () => {
    if (!policy) return;
    setSaving(true);
    try { await updateSlaPolicy(policy); setSaved(policy); Alert.alert('Kaydedildi', 'SLA kuralı güncellendi.'); await load(); }
    catch (e: any) { Alert.alert('Kaydedilemedi', e?.message ?? 'Lütfen tekrar dene.'); }
    finally { setSaving(false); }
  };
  const resolve = async (row: SlaViolationRow, status: 'waived' | 'collected') => {
    try { await resolveSlaViolation(row.id, status); await load(); }
    catch (e: any) { Alert.alert('İşlenemedi', e?.message ?? 'Lütfen tekrar dene.'); }
  };
  // Tahsilat yalnızca kayıttır; hakedişten para düşülmez. Yanlışlıkla basılmaması için onay istenir.
  const confirmCollected = (row: SlaViolationRow) => Alert.alert(
    'Ceza tahsil edildi mi?',
    `${row.seller_name} için ${moneyTL(row.penalty_cents)} ceza tahsil edildi olarak kaydedilecek. Hakedişten para düşülmez.`,
    [{ text: 'Vazgeç', style: 'cancel' }, { text: 'Kaydet', onPress: () => { void resolve(row, 'collected'); } }],
  );

  return (
    <View style={st.safe}>
      <TopBar title="SLA yönetimi" subtitle="Yanıt, hazırlık ve ceza kuralları" back />
      {loading ? <View style={st.center}><LogoLoader /></View> : (
        <ScrollView contentContainerStyle={st.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.primary} />}>
          <View style={st.metrics}>
            <MetricCard label="Görünen ihlal" value={String(rows.length)} icon="timer-outline" variant={rows.length ? 'warning' : 'accent'} />
            <MetricCard label="Toplam ceza" value={moneyTL(rows.reduce((sum, r) => sum + r.penalty_cents, 0), true)} icon="cash-outline" />
          </View>
          {policy ? <>
            <SectionHeader title="SLA kuralı" subtitle="Müşteri deneyimini etkileyen otomasyon" />
            <SlaPolicyEditor policy={policy} dirty={dirty} saving={saving} onChange={setPolicy} onSave={save} />
          </> : null}
          <SectionHeader title="İhlal geçmişi" subtitle="Açık, affedilen ve tahsil edilen kayıtlar" />
          <SegmentedControl options={[{ value: 'open', label: 'Açık' }, { value: 'waived', label: 'Affedilen' }, { value: 'collected', label: 'Tahsil edilen' }]} value={filter} onChange={setFilter} />
          {rows.length === 0 ? <EmptyState title="Bu durumda ihlal yok" description="Diğer SLA kayıtları için filtreyi değiştir." icon="shield-checkmark-outline" /> : rows.map(row => {
            const status = enterpriseStatus(SLA_STATUS, row.status);
            return <View key={row.id} style={[st.card, { backgroundColor: t.surface }]}>
              <View style={st.rowHead}><Text style={[st.title, { color: t.text }]}>{row.violation_type === 'acceptance_timeout' ? 'Onay gecikmesi' : 'Hazırlama gecikmesi'}</Text><StatusPill label={status.label} variant={status.variant} /></View>
              <Text style={[st.sub, { color: t.textSecondary }]}>{row.seller_name} · #{row.order_id.slice(0, 8)} · {row.minutes_late} dk gecikme</Text>
              <Text style={[st.sub, { color: t.textSecondary }]}>{dateTR(row.occurred_at, true)} · Ceza {moneyTL(row.penalty_cents)}</Text>
              {row.status === 'open' ? <View style={st.actions}><Button label="Affet" variant="outline" size="sm" onPress={() => resolve(row, 'waived')} /><Button label="Tahsil edildi" size="sm" onPress={() => confirmCollected(row)} /></View> : null}
            </View>;
          })}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 12 }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, card: { borderRadius: 16, padding: 14, gap: 9 },
  title: { fontSize: 15, fontFamily: fonts.bold, color: t.text }, sub: { fontSize: 13, lineHeight: 19, fontFamily: fonts.regular },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

