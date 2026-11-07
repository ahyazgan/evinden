import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LogoLoader } from '@/components/shared/Logo';
import { StatusPill } from '@/components/ui/Enterprise';
import {
  CORPORATE_STATUS_TEXT, corporateBudgetLeft, corporateBudgetRatio, fetchCorporateReport, fetchMyCorporateWorkspace,
  formatJoinCode, joinCorporateWorkspace, leaveCorporateWorkspace, normalizeJoinCode, regenerateCorporateCode,
  removeCorporateMember, requestCorporateWorkspace, updateCorporateBudget, type CorporateReport, type MyCorporateWorkspace,
} from '@/lib/corporate';
import { centsToTLInput, parseTLToCents } from '@/lib/pricing';
import { useAuth } from '@/lib/auth-context';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

const money = (cents: number) => `₺${(cents / 100).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const STATUS_VARIANT = { pending: 'amber', active: 'success', suspended: 'danger' } as const;
const ORDER_STATUS: Record<string, string> = {
  awaiting_payment: 'Ödeme bekliyor', pending: 'Onay bekliyor', accepted: 'Kabul edildi', preparing: 'Hazırlanıyor',
  ready: 'Hazır', out_for_delivery: 'Yolda', delivered: 'Teslim edildi', cancelled: 'İptal',
};

/** Kurumsal hesap (060): talep, kodla katılım, şirket sahibinin üye ve harcama yönetimi. */
export default function CorporateScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const { session } = useAuth();
  const [ws, setWs] = useState<MyCorporateWorkspace | null>(null);
  const [report, setReport] = useState<CorporateReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [code, setCode] = useState('');
  const [editBudget, setEditBudget] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.userId) { setLoading(false); return; }
    try {
      const mine = await fetchMyCorporateWorkspace();
      setWs(mine);
      if (mine && mine.role === 'owner' && mine.member_status === 'active') {
        setReport(await fetchCorporateReport());
      } else {
        setReport(null);
      }
    } catch {
      Alert.alert('Bilgiler alınamadı', 'İnternet bağlantını kontrol edip tekrar dene.');
    } finally {
      setLoading(false);
    }
  }, [session?.userId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try { await fn(); } catch (e: any) { Alert.alert('İşlem yapılamadı', e?.message ?? 'Lütfen tekrar dene.'); } finally { setBusy(null); }
  };

  const submitRequest = () => {
    const cents = parseTLToCents(budget);
    if (name.trim().length < 2) { Alert.alert('Şirket adı', 'Şirketinin adını yaz.'); return; }
    if (cents === undefined) { Alert.alert('Aylık bütçe', 'Bütçeyi 5000 veya 5000,50 biçiminde yaz ya da boş bırak.'); return; }
    void run('request', async () => {
      await requestCorporateWorkspace(name, cents);
      setName(''); setBudget('');
      await load();
      Alert.alert('Talebin alındı', 'Onaylanınca bildirim alırsın ve çalışanların için bir katılım kodu oluşur.');
    });
  };

  const submitJoin = () => {
    if (normalizeJoinCode(code).length !== 8) { Alert.alert('Katılım kodu', 'Kod 8 karakterdir, örneğin ABCD-EFGH.'); return; }
    void run('join', async () => {
      const ok = await joinCorporateWorkspace(code);
      if (!ok) { Alert.alert('Kod bulunamadı', 'Kodu şirketindeki sorumludan kontrol edip tekrar yaz.'); return; }
      setCode('');
      await load();
    });
  };

  const confirmLeave = () => Alert.alert('Şirket hesabından ayrıl', 'Bundan sonra şirket siparişi veremezsin. Geçmiş siparişlerin şirketin raporunda kalır.', [
    { text: 'Vazgeç', style: 'cancel' },
    { text: 'Ayrıl', style: 'destructive', onPress: () => { void run('leave', async () => { await leaveCorporateWorkspace(); await load(); }); } },
  ]);

  const confirmRemove = (userId: string, memberName: string) => Alert.alert('Üyeyi çıkar', `${memberName} şirket siparişi veremeyecek.`, [
    { text: 'Vazgeç', style: 'cancel' },
    { text: 'Çıkar', style: 'destructive', onPress: () => { void run(`remove-${userId}`, async () => { await removeCorporateMember(userId); await load(); }); } },
  ]);

  const confirmNewCode = () => Alert.alert('Yeni kod oluştur', 'Eski kod hemen geçersiz olur. Mevcut üyeler etkilenmez.', [
    { text: 'Vazgeç', style: 'cancel' },
    { text: 'Yeni kod', onPress: () => { void run('code', async () => { await regenerateCorporateCode(); await load(); }); } },
  ]);

  const saveBudget = () => {
    if (editBudget === null) return;
    const cents = parseTLToCents(editBudget);
    if (cents === undefined) { Alert.alert('Aylık bütçe', 'Bütçeyi 5000 veya 5000,50 biçiminde yaz ya da sınırsız için boş bırak.'); return; }
    void run('budget', async () => { await updateCorporateBudget(cents); setEditBudget(null); await load(); });
  };

  const copyCode = async (value: string) => {
    try { await Clipboard.setStringAsync(value); Alert.alert('Kopyalandı', `${value} panoya kopyalandı.`); } catch { /* Pano her platformda yok. */ }
  };

  const member = ws && ws.member_status === 'active';
  const owner = member && ws.role === 'owner';
  const left = ws ? corporateBudgetLeft(ws) : null;
  const ratio = ws ? corporateBudgetRatio(ws) : null;

  return (
    <View style={st.safe}>
      <TopBar title="Kurumsal hesap" back />
      {loading ? <View style={st.center}><LogoLoader /></View> : (
        <ScrollView contentContainerStyle={st.list} keyboardShouldPersistTaps="handled">
          {!member ? (
            <>
              <Text style={st.lead}>
                Şirketin için bir hesap aç ya da şirketinin sana verdiği kodla katıl. Şirket siparişleri aylık bütçeden düşer
                ve şirketin sorumlusu kimin ne harcadığını görür. Ödemeyi sipariş veren kişi yapar.
              </Text>

              {ws && ws.role === 'owner' ? (
                <View style={[st.card, { backgroundColor: t.surface }]}>
                  <View style={st.head}><Text style={st.title}>{ws.name}</Text><StatusPill label={CORPORATE_STATUS_TEXT[ws.status]} variant={STATUS_VARIANT[ws.status]} /></View>
                  <Text style={st.sub}>
                    {ws.status === 'pending' ? 'Talebin inceleniyor. Onaylanınca bildirim alırsın.'
                      : ws.status === 'suspended' ? 'Bu şirket hesabı askıya alındı. Ayrıntı için destekle yazışabilirsin.'
                      : 'Hesap etkin.'}
                  </Text>
                </View>
              ) : null}

              <Text style={st.sectionTitle}>Kodla katıl</Text>
              <View style={[st.card, { backgroundColor: t.surface }]}>
                <Input label="Katılım kodu" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="ABCD-EFGH" maxLength={9} />
                <Button label="Katıl" onPress={submitJoin} loading={busy === 'join'} disabled={!!busy} fullWidth />
              </View>

              {!(ws && ws.role === 'owner' && ws.status === 'pending') ? (
                <>
                  <Text style={st.sectionTitle}>Şirket hesabı aç</Text>
                  <View style={[st.card, { backgroundColor: t.surface }]}>
                    <Input label="Şirket adı" value={name} onChangeText={setName} maxLength={120} />
                    <Input label="Aylık bütçe, TL (isteğe bağlı)" value={budget} onChangeText={setBudget} keyboardType="decimal-pad" hint="Boş bırakırsan sınır olmaz; harcamayı yine görürsün." />
                    <Button label="Talep gönder" onPress={submitRequest} loading={busy === 'request'} disabled={!!busy} fullWidth />
                  </View>
                </>
              ) : null}
            </>
          ) : (
            <>
              <View style={[st.card, { backgroundColor: t.surface }]}>
                <View style={st.head}><Text style={st.title}>{ws.name}</Text><StatusPill label={CORPORATE_STATUS_TEXT[ws.status]} variant={STATUS_VARIANT[ws.status]} /></View>
                {ws.status !== 'active' ? (
                  <Text style={[st.sub, { color: t.danger }]}>Hesap askıda; şirket siparişi verilemez.</Text>
                ) : null}
                <Text style={st.big}>{money(ws.month_spent_cents)}</Text>
                <Text style={st.sub}>
                  {ws.monthly_budget_cents == null ? 'Bu ay şirket harcaması · bütçe sınırı yok' : `Bu ay harcanan · bütçe ${money(ws.monthly_budget_cents)}, kalan ${money(left ?? 0)}`}
                </Text>
                {ratio !== null ? (
                  <View style={[st.bar, { backgroundColor: t.background }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}>
                    <View style={[st.barFill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: ratio >= 0.9 ? t.danger : t.primary }]} />
                  </View>
                ) : null}
                {!owner ? <Text style={st.sub}>Senin bu ayki şirket siparişlerin: {money(ws.my_month_spent_cents)}</Text> : null}
                <Text style={st.hint}>Sepette "Bu sipariş şirket hesabına sayılsın" seçeneğini işaretlediğin siparişler buraya düşer.</Text>
              </View>

              {owner ? (
                <>
                  <Text style={st.sectionTitle}>Katılım kodu</Text>
                  <View style={[st.card, { backgroundColor: t.surface }]}>
                    <Pressable onPress={() => ws.join_code && copyCode(formatJoinCode(ws.join_code))} accessibilityRole="button" accessibilityLabel={`Katılım kodu ${formatJoinCode(ws.join_code)}, kopyala`}>
                      <Text style={st.code}>{formatJoinCode(ws.join_code)}</Text>
                    </Pressable>
                    <Text style={st.hint}>Çalışanların Profil &gt; Kurumsal hesap ekranında bu kodu yazarak katılır. Koda dokununca kopyalanır.</Text>
                    <Button label="Yeni kod oluştur" variant="outline" size="sm" onPress={confirmNewCode} loading={busy === 'code'} disabled={!!busy} />
                  </View>

                  <Text style={st.sectionTitle}>Aylık bütçe</Text>
                  <View style={[st.card, { backgroundColor: t.surface }]}>
                    {editBudget === null ? (
                      <>
                        <Text style={st.title}>{ws.monthly_budget_cents == null ? 'Sınır yok' : money(ws.monthly_budget_cents)}</Text>
                        <Button label="Değiştir" variant="outline" size="sm" onPress={() => setEditBudget(centsToTLInput(ws.monthly_budget_cents))} />
                      </>
                    ) : (
                      <>
                        <Input label="Aylık bütçe, TL" value={editBudget} onChangeText={setEditBudget} keyboardType="decimal-pad" hint="Sınırsız için boş bırak. Bütçe aşılırsa şirket siparişi verilemez." />
                        <View style={st.row}>
                          <View style={st.flex}><Button label="Vazgeç" variant="outline" fullWidth onPress={() => setEditBudget(null)} /></View>
                          <View style={st.flex}><Button label="Kaydet" fullWidth onPress={saveBudget} loading={busy === 'budget'} disabled={!!busy} /></View>
                        </View>
                      </>
                    )}
                  </View>

                  <Text style={st.sectionTitle}>Üyeler</Text>
                  {(report?.members ?? []).map(m => (
                    <View key={m.user_id} style={[st.card, { backgroundColor: t.surface }]}>
                      <View style={st.head}>
                        <Text style={st.title}>{m.name}{m.role === 'owner' ? ' (sen)' : ''}</Text>
                        <Text style={st.amount}>{money(m.spent_cents)}</Text>
                      </View>
                      <Text style={st.sub}>Bu ay {m.order_count} sipariş · {new Date(m.joined_at).toLocaleDateString('tr-TR')} tarihinde katıldı</Text>
                      {m.role !== 'owner' ? (
                        <Button label="Çıkar" variant="outline" size="sm" onPress={() => confirmRemove(m.user_id, m.name)} loading={busy === `remove-${m.user_id}`} disabled={!!busy} />
                      ) : null}
                    </View>
                  ))}

                  <Text style={st.sectionTitle}>Bu ayın şirket siparişleri</Text>
                  {(report?.orders ?? []).length === 0 ? <Text style={st.sub}>Bu ay şirket siparişi yok.</Text> : (report?.orders ?? []).map(o => (
                    <View key={o.id} style={[st.card, { backgroundColor: t.surface }]}>
                      <View style={st.head}>
                        <Text style={st.title}>{o.member_name} · {o.restaurant_name}</Text>
                        <Text style={[st.amount, o.status === 'cancelled' && { color: t.textMuted, textDecorationLine: 'line-through' }]}>{money(o.total_cents)}</Text>
                      </View>
                      <Text style={st.sub}>{new Date(o.created_at).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · {ORDER_STATUS[o.status] ?? o.status}</Text>
                    </View>
                  ))}
                </>
              ) : (
                <Button label="Şirket hesabından ayrıl" variant="outline" onPress={confirmLeave} loading={busy === 'leave'} disabled={!!busy} fullWidth />
              )}
            </>
          )}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 18, color: t.heading, marginTop: 4 },
  lead: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: t.textSecondary },
  card: { borderRadius: 16, padding: 14, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: t.text },
  amount: { fontFamily: fonts.bold, fontSize: 15, color: t.text },
  big: { fontFamily: fonts.extrabold, fontSize: 26, color: t.heading },
  code: { fontFamily: fonts.extrabold, fontSize: 28, letterSpacing: 3, color: t.heading, textAlign: 'center', paddingVertical: 6 },
  sub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: t.textSecondary },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: t.textSecondary },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1, minWidth: 0 },
});
