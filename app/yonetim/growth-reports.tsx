import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { TopBar } from '@/components/shared/TopBar';
import { LogoLoader } from '@/components/shared/Logo';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState, MetricCard, SectionHeader, SegmentedControl, StatusPill } from '@/components/ui/Enterprise';
import { moneyTL } from '@/lib/enterprise-format';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';
import {
  bpsLabel,
  fetchCampaignPerformance,
  fetchSellerQuality,
  fetchUnitEconomics,
  fetchUnitEconomicsSettings,
  fetchWinbackCustomers,
  qualityLevel,
  updateUnitEconomicsSettings,
  type CampaignPerformanceRow,
  type SellerQualityRow,
  type UnitEconomics,
  type UnitEconomicsSettings,
  type WinbackRow,
} from '@/lib/growth-reports';

type Tab = 'quality' | 'economics' | 'campaigns' | 'winback';
const PERIODS = [7, 30, 90] as const;

/** Eksi değeri "-₺12,00" biçiminde yazar. */
const signedTL = (cents: number) => `${cents < 0 ? '-' : ''}${moneyTL(Math.abs(cents))}`;

const LEVEL: Record<ReturnType<typeof qualityLevel>, { label: string; variant: 'success' | 'amber' | 'danger' | 'muted' }> = {
  new: { label: 'Yeni', variant: 'muted' },
  good: { label: 'İyi', variant: 'success' },
  watch: { label: 'İzle', variant: 'amber' },
  risk: { label: 'Riskli', variant: 'danger' },
};

export default function GrowthReportsScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('quality');
  const [days, setDays] = useState<number>(30);
  const [quality, setQuality] = useState<SellerQualityRow[]>([]);
  const [economics, setEconomics] = useState<UnitEconomics | null>(null);
  const [settings, setSettings] = useState<UnitEconomicsSettings | null>(null);
  const [draft, setDraft] = useState<Record<keyof UnitEconomicsSettings, string> | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignPerformanceRow[]>([]);
  const [winback, setWinback] = useState<WinbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const seq = useRef(0);
  const load = useCallback(async () => {
    // Sekme değişince önceki isteğin sonucu (ya da hatası) yeni sekmeye yazılmaz.
    const mine = ++seq.current;
    const stale = () => mine !== seq.current;
    setFailed(false);
    try {
      // Kalite ve geri kazanım sabit dönemlidir (90 gün); dönem seçici yalnızca diğer iki sekmede.
      if (tab === 'quality') { const q = await fetchSellerQuality(90); if (!stale()) setQuality(q); }
      if (tab === 'economics') {
        const [e, s] = await Promise.all([fetchUnitEconomics(days), fetchUnitEconomicsSettings()]);
        if (stale()) return;
        setEconomics(e);
        setSettings(s);
        setDraft({
          delivery_cost_cents: String(s.delivery_cost_cents / 100).replace('.', ','),
          support_cost_cents: String(s.support_cost_cents / 100).replace('.', ','),
          payment_fee_bps: String(s.payment_fee_bps / 100).replace('.', ','),
          acquisition_cost_cents: String(s.acquisition_cost_cents / 100).replace('.', ','),
        });
      }
      if (tab === 'campaigns') { const c = await fetchCampaignPerformance(days); if (!stale()) setCampaigns(c); }
      if (tab === 'winback') { const w = await fetchWinbackCustomers(90); if (!stale()) setWinback(w); }
    } catch {
      if (!stale()) setFailed(true);
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [tab, days]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const saveSettings = async () => {
    if (!draft) return;
    const parse = (v: string) => {
      const text = v.trim().replace(',', '.');
      return /^\d+(\.\d{1,2})?$/.test(text) ? Math.round(Number(text) * 100) : NaN;
    };
    const next = {
      delivery_cost_cents: parse(draft.delivery_cost_cents),
      support_cost_cents: parse(draft.support_cost_cents),
      payment_fee_bps: parse(draft.payment_fee_bps),
      acquisition_cost_cents: parse(draft.acquisition_cost_cents),
    };
    if (Object.values(next).some(v => !Number.isFinite(v) || v > 999999)) {
      Alert.alert('Geçersiz değer', 'Tutarları ₺ olarak (ör. 25 veya 12,50), ödeme komisyonunu yüzde olarak (ör. 2,9) yaz.');
      return;
    }
    if (next.payment_fee_bps > 2000) { Alert.alert('Geçersiz oran', 'Ödeme komisyonu en fazla %20 olabilir.'); return; }
    setSaving(true);
    try {
      await updateUnitEconomicsSettings(next);
      await load();
    } catch (e: any) {
      Alert.alert('Kaydedilemedi', e?.code === '22023' ? e.message : 'Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  const riskCount = quality.filter(r => qualityLevel(r.score, r.orders) === 'risk').length;
  const contributionTotal = campaigns.reduce((sum, c) => sum + c.contribution_cents, 0);

  return (
    <View style={st.safe}>
      <TopBar title="Büyüme raporları" subtitle="Restoran kalitesi, birim ekonomi, kampanyalar" back />
      <View style={st.controls}>
        <SegmentedControl
          options={[
            { value: 'quality', label: 'Kalite' },
            { value: 'economics', label: 'Birim ekonomi' },
            { value: 'campaigns', label: 'Kampanyalar' },
            { value: 'winback', label: 'Geri kazanım' },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'economics' || tab === 'campaigns' ? (
          <SegmentedControl options={PERIODS.map(value => ({ value, label: `${value} gün` }))} value={days} onChange={setDays} />
        ) : null}
      </View>

      {loading ? <View style={st.center}><LogoLoader /></View> : failed ? (
        <View style={st.center}>
          <Text style={[st.muted, { color: t.textSecondary }]}>Rapor alınamadı.</Text>
          <Button label="Tekrar dene" onPress={load} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={st.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.primary} />}>
          {tab === 'quality' ? (
            <>
              <View style={st.cards}>
                <MetricCard label="Restoran" value={String(quality.length)} icon="storefront-outline" />
                <MetricCard label="Riskli" value={String(riskCount)} hint="Puanı 60'ın altında" icon="alert-circle-outline" variant={riskCount ? 'danger' : 'accent'} />
              </View>
              <Text style={[st.note, { color: t.textSecondary }]}>
                Son 90 gün. Puan; değerlendirme (%40), iptal (%25), iade (%20) ve gecikme (%15) oranlarından hesaplanır. 5 siparişten azı olan restoran 50 ile "Yeni" görünür. Ödemesi tamamlanmamış online siparişler sayılmaz.
              </Text>
              {quality.length === 0 ? <EmptyState title="Restoran yok" description="Satıştaki ya da sipariş almış restoran yok." icon="storefront-outline" /> : quality.map(r => {
                const level = LEVEL[qualityLevel(r.score, r.orders)];
                return (
                  <View key={r.seller_id} style={st.card}>
                    <View style={st.rowHead}>
                      <Text style={st.title} numberOfLines={1}>{r.display_name}{r.is_active ? '' : ' (pasif)'}</Text>
                      <StatusPill label={`${level.label} · ${r.score.toFixed(0)}`} variant={level.variant} />
                    </View>
                    <Text style={st.meta}>
                      {r.orders} sipariş · {r.cancelled} iptal · {r.refunds} iade · {r.sla_violations} gecikme · ★ {r.rating.toFixed(1).replace('.', ',')}
                    </Text>
                  </View>
                );
              })}
            </>
          ) : null}

          {tab === 'economics' && economics ? (
            <>
              <View style={st.cards}>
                <MetricCard label="Sipariş" value={String(economics.orders)} hint="Teslim edilen, iadesiz" icon="receipt-outline" />
                <MetricCard label="Katkı" value={signedTL(economics.contribution_cents)} hint={`Sipariş başı ${signedTL(economics.contribution_per_order_cents)}`} icon="trending-up-outline" variant={economics.contribution_cents < 0 ? 'danger' : 'accent'} />
                <MetricCard label="Marj" value={bpsLabel(economics.margin_bps)} hint="Katkı / ciro" icon="pie-chart-outline" variant={economics.margin_bps < 0 ? 'danger' : 'default'} />
              </View>
              <View style={st.card}>
                <SectionHeader title="Hesap" subtitle={`Son ${economics.days} gün`} />
                {[
                  ['Ciro (ara toplam)', economics.gross_cents, false],
                  ['Komisyon geliri', economics.commission_cents, false],
                  ['Platformun karşıladığı indirim', -economics.discount_cents, true],
                  ['Kurye maliyeti (platform kuryesi)', -economics.delivery_cost_cents, true],
                  ['Destek maliyeti', -economics.support_cost_cents, true],
                  ['Ödeme komisyonu (online)', -economics.payment_fee_cents, true],
                  ['Müşteri edinme', -economics.acquisition_cost_cents, true],
                ].map(([label, value, cost]) => (
                  <View key={label as string} style={st.line}>
                    <Text style={st.lineLabel}>{label as string}</Text>
                    <Text style={[st.lineValue, cost && (value as number) < 0 ? { color: t.danger } : null]}>{signedTL(value as number)}</Text>
                  </View>
                ))}
                <View style={[st.line, st.total]}>
                  <Text style={st.lineLabel}>Katkı</Text>
                  <Text style={st.lineValue}>{signedTL(economics.contribution_cents)}</Text>
                </View>
                <Text style={st.meta}>Ciro hesaba girmez; yalnızca marjın paydasıdır. İade talebi olan sipariş: {economics.refunds}.</Text>
              </View>
              {draft && settings ? (
                <View style={st.card}>
                  <SectionHeader title="Varsayımlar" subtitle="Rapor bu değerlerle hesaplanır" />
                  <Input label="Platform kuryesi maliyeti (₺ / sipariş)" value={draft.delivery_cost_cents} onChangeText={v => setDraft(d => d && ({ ...d, delivery_cost_cents: v }))} keyboardType="decimal-pad" />
                  <Input label="Destek maliyeti (₺ / sipariş)" value={draft.support_cost_cents} onChangeText={v => setDraft(d => d && ({ ...d, support_cost_cents: v }))} keyboardType="decimal-pad" />
                  <Input label="Ödeme komisyonu (% / online sipariş)" value={draft.payment_fee_bps} onChangeText={v => setDraft(d => d && ({ ...d, payment_fee_bps: v }))} keyboardType="decimal-pad" />
                  <Input label="Müşteri edinme (₺ / sipariş)" value={draft.acquisition_cost_cents} onChangeText={v => setDraft(d => d && ({ ...d, acquisition_cost_cents: v }))} keyboardType="decimal-pad" />
                  <Button label="Varsayımları kaydet" loading={saving} onPress={saveSettings} />
                </View>
              ) : null}
            </>
          ) : null}

          {tab === 'campaigns' ? (
            <>
              <View style={st.cards}>
                <MetricCard label="Kampanya" value={String(campaigns.length)} icon="pricetag-outline" />
                <MetricCard label="Toplam katkı" value={signedTL(contributionTotal)} icon="trending-up-outline" variant={contributionTotal < 0 ? 'danger' : 'accent'} />
              </View>
              <Text style={[st.note, { color: t.textSecondary }]}>
                Yalnızca teslim edilmiş ve iade edilmemiş siparişler sayılır. Restoranın kendi kampanyasında indirimi restoran karşılar; katkıdan yalnızca platformun karşıladığı indirim düşülür.
              </Text>
              {campaigns.length === 0 ? <EmptyState title="Kampanya yok" description="Bu dönemde kullanılan ya da açılan kupon yok." icon="pricetag-outline" actionLabel="Kupon oluştur" onAction={() => router.push('/yonetim/coupons' as any)} /> : campaigns.map(c => (
                <View key={c.coupon_id} style={st.card}>
                  <View style={st.rowHead}>
                    <Text style={st.title} numberOfLines={1}>{c.title}</Text>
                    <StatusPill label={c.seller_name ? 'Restoran' : 'Platform'} variant={c.seller_name ? 'muted' : 'info'} />
                  </View>
                  <Text style={st.meta}>{c.code}{c.seller_name ? ` · ${c.seller_name}` : ''}</Text>
                  <Text style={st.meta}>
                    {c.redemptions} kullanım · ciro {moneyTL(c.gross_cents)} · indirim {moneyTL(c.discount_cents)} · {c.refunds} iade
                  </Text>
                  <View style={st.line}>
                    <Text style={st.lineLabel}>Katkı · marj {bpsLabel(c.margin_bps)}</Text>
                    <Text style={[st.lineValue, c.contribution_cents < 0 ? { color: t.danger } : null]}>{signedTL(c.contribution_cents)}</Text>
                  </View>
                </View>
              ))}
            </>
          ) : null}

          {tab === 'winback' ? (
            <>
              <Text style={[st.note, { color: t.textSecondary }]}>
                Son bir yıl içinde en az bir siparişi teslim edilmiş ama 90 gündür sipariş vermemiş müşteriler. Kampanya ile geri çağırmak için kupon oluşturabilirsin.
              </Text>
              {winback.length === 0 ? <EmptyState title="Geri kazanılacak müşteri yok" description="Bütün müşteriler son 90 günde sipariş vermiş." icon="people-outline" /> : winback.map(w => (
                <View key={w.customer_id} style={st.card}>
                  <View style={st.rowHead}>
                    <Text style={st.title} numberOfLines={1}>{w.customer_name || 'Müşteri'}</Text>
                    <Text style={st.meta}>{w.days_since} gündür yok</Text>
                  </View>
                  <Text style={st.meta}>{w.orders} sipariş · {moneyTL(w.spend_cents)} · son {new Date(w.last_order_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                </View>
              ))}
            </>
          ) : null}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background },
  controls: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  muted: { fontSize: 14, fontFamily: fonts.regular },
  list: { padding: 16, gap: 10 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  note: { fontSize: 12, lineHeight: 18, fontFamily: fonts.regular },
  card: { backgroundColor: t.surface, borderRadius: 16, padding: 14, gap: 8 },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { flex: 1, fontSize: 15, fontFamily: fonts.bold, color: t.text },
  meta: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, color: t.textSecondary },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, minHeight: 28, alignItems: 'center' },
  total: { borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 8 },
  lineLabel: { flex: 1, fontSize: 13, fontFamily: fonts.medium, color: t.text },
  lineValue: { fontSize: 13, fontFamily: fonts.bold, color: t.text },
});
