import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LogoLoader } from '@/components/shared/Logo';
import { StatusPill } from '@/components/ui/Enterprise';
import { useAuth } from '@/lib/auth-context';
import { fetchSellerByUserId } from '@/lib/db';
import {
  deletePosIntegration, fetchPosDeliveries, fetchPosIntegration, POS_EVENT_TEXT, posApiBase, posDeliveryResult,
  rotatePosCredentials, savePosIntegration, sendPosTest, type PosCredentials, type PosDelivery, type PosIntegration,
} from '@/lib/pos';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

/** Restoran: POS veya kendi yazılımına sipariş bildirimi ve "bitti" eşitlemesi (060). */
export default function SellerPosScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const { profile } = useAuth();
  const [integration, setIntegration] = useState<PosIntegration | null>(null);
  const [deliveries, setDeliveries] = useState<PosDelivery[]>([]);
  const [url, setUrl] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [credentials, setCredentials] = useState<PosCredentials | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.id) { setLoading(false); return; }
    try {
      const seller = await fetchSellerByUserId(profile.id);
      if (!seller) return;
      const row = await fetchPosIntegration(seller.id);
      setIntegration(row);
      if (row) {
        setUrl(row.config?.webhook_url ?? '');
        setEnabled(row.status === 'active');
        setDeliveries(await fetchPosDeliveries().catch(() => []));
      }
    } catch {
      Alert.alert('Bilgiler alınamadı', 'İnternet bağlantını kontrol edip tekrar dene.');
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try { await fn(); } catch (e: any) { Alert.alert('İşlem yapılamadı', e?.message ?? 'Lütfen tekrar dene.'); } finally { setBusy(null); }
  };

  const save = () => run('save', async () => {
    const r = await savePosIntegration(url, enabled);
    setIntegration(r.integration);
    if (r.credentials) setCredentials(r.credentials);
    await load();
    if (!r.credentials) Alert.alert('Kaydedildi', enabled ? 'Yeni siparişler bu adrese gönderilecek.' : 'Bağlantı kapalı; sipariş gönderilmez ve API anahtarı çalışmaz.');
  });

  const rotate = () => Alert.alert('Anahtarları yenile', 'Eski API anahtarı ve imza anahtarı hemen geçersiz olur. POS ayarlarını yenileriyle güncellemen gerekir.', [
    { text: 'Vazgeç', style: 'cancel' },
    { text: 'Yenile', style: 'destructive', onPress: () => { void run('rotate', async () => { setCredentials(await rotatePosCredentials()); }); } },
  ]);

  const remove = () => Alert.alert('Bağlantıyı sil', 'Sipariş gönderimi durur, anahtarlar silinir.', [
    { text: 'Vazgeç', style: 'cancel' },
    { text: 'Sil', style: 'destructive', onPress: () => { void run('delete', async () => {
      await deletePosIntegration();
      setIntegration(null); setCredentials(null); setDeliveries([]); setUrl(''); setEnabled(true);
    }); } },
  ]);

  const test = () => run('test', async () => {
    await sendPosTest();
    Alert.alert('Deneme gönderildi', 'Birkaç saniye sonra listeyi yenileyip sonucu görebilirsin.');
    setTimeout(() => { fetchPosDeliveries().then(setDeliveries).catch(() => undefined); }, 4000);
  });

  const copy = async (label: string, value: string) => {
    try { await Clipboard.setStringAsync(value); Alert.alert('Kopyalandı', `${label} panoya kopyalandı.`); } catch { /* Pano her platformda yok. */ }
  };

  return (
    <View style={st.safe}>
      <TopBar title="POS bağlantısı" back />
      {loading ? <View style={st.center}><LogoLoader /></View> : (
        <ScrollView contentContainerStyle={st.list} keyboardShouldPersistTaps="handled">
          <Text style={st.lead}>
            Kasa sistemin (POS) ya da kendi yazılımın Afiyetli siparişlerini otomatik alsın. Yeni sipariş ve durum değişikliği yazdığın
            adrese imzalı olarak gönderilir. POS, API anahtarıyla menünü okuyup ürünleri "bitti" yapabilir. Kurulumu POS firmanla birlikte yap.
          </Text>

          {credentials ? (
            <View style={[st.card, { backgroundColor: t.brand }]}>
              <Text style={[st.title, { color: t.onBrand }]}>Anahtarlarını şimdi kaydet</Text>
              <Text style={[st.sub, { color: t.onBrandSoft }]}>Bu anahtarlar bir daha gösterilmez. Kaybedersen "Anahtarları yenile" ile yenilerini alırsın.</Text>
              {([['API anahtarı', credentials.api_key], ['İmza anahtarı', credentials.signing_secret]] as const).map(([label, value]) => (
                <Pressable key={label} onPress={() => copy(label, value)} accessibilityRole="button" accessibilityLabel={`${label}, kopyala`} style={[st.secretRow, { backgroundColor: t.panel }]}>
                  <Text style={[st.secretLabel, { color: t.onBrandSoft }]}>{label}</Text>
                  <Text style={[st.mono, { color: t.onBrand }]} selectable>{value}</Text>
                </Pressable>
              ))}
              <Button label="Kaydettim" variant="accent" size="sm" onPress={() => setCredentials(null)} />
            </View>
          ) : null}

          <View style={[st.card, { backgroundColor: t.surface }]}>
            <View style={st.head}>
              <Text style={st.title}>Sipariş bildirimi</Text>
              {integration ? <StatusPill label={integration.status === 'active' ? 'Açık' : 'Kapalı'} variant={integration.status === 'active' ? 'success' : 'muted'} /> : null}
            </View>
            <Input
              label="Bildirim adresi"
              value={url}
              onChangeText={setUrl}
              placeholder="https://pos.ornek.com/afiyetli"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              hint="https:// ile başlamalı. IP adresi ve özel port kabul edilmez."
            />
            <View style={st.switchRow}>
              <Text style={st.switchText}>Bağlantı açık</Text>
              <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: t.primary, false: t.divider }} thumbColor={t.onBrand} accessibilityLabel="Bağlantı açık" />
            </View>
            <Button label={integration ? 'Kaydet' : 'Bağlantıyı oluştur'} onPress={save} loading={busy === 'save'} disabled={!!busy} fullWidth />
            {integration ? (
              <View style={st.row}>
                <View style={st.flex}><Button label="Deneme gönder" variant="outline" size="sm" fullWidth onPress={test} loading={busy === 'test'} disabled={!!busy || integration.status !== 'active'} /></View>
                <View style={st.flex}><Button label="Anahtarları yenile" variant="outline" size="sm" fullWidth onPress={rotate} loading={busy === 'rotate'} disabled={!!busy} /></View>
              </View>
            ) : null}
          </View>

          {integration ? (
            <>
              <Text style={st.sectionTitle}>POS'un kullanacağı adresler</Text>
              <View style={[st.card, { backgroundColor: t.surface }]}>
                <Text style={st.sub}>Menüyü okumak için <Text style={st.mono}>pos_menu</Text>, ürünü bitti yapmak için <Text style={st.mono}>pos_set_availability</Text> çağrılır. API anahtarı istek gövdesinde gider.</Text>
                <Pressable onPress={() => copy('Adres', posApiBase())} accessibilityRole="button" accessibilityLabel="API adresini kopyala" style={[st.secretRow, { backgroundColor: t.background }]}>
                  <Text style={st.mono} selectable>{posApiBase()}/pos_set_availability</Text>
                </Pressable>
                <Text style={st.hint}>Gelen her bildirimde X-Afiyetli-Signature başlığını imza anahtarıyla doğrula. Ayrıntılı kurulum notunu destekten isteyebilirsin.</Text>
              </View>

              <Text style={st.sectionTitle}>Son gönderimler</Text>
              {deliveries.length === 0 ? <Text style={st.sub}>Henüz gönderim yok.</Text> : deliveries.map(d => {
                const r = posDeliveryResult(d);
                return (
                  <View key={d.id} style={[st.card, { backgroundColor: t.surface }]}>
                    <View style={st.head}>
                      <Text style={st.title}>{POS_EVENT_TEXT[d.event] ?? d.event}{d.order_id ? ` · #${d.order_id.slice(0, 8).toUpperCase()}` : ''}</Text>
                      <StatusPill label={r.label} variant={r.ok === true ? 'success' : r.ok === false ? 'danger' : 'muted'} />
                    </View>
                    <Text style={st.sub}>{new Date(d.created_at).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Text>
                  </View>
                );
              })}
              <Button label="Listeyi yenile" variant="secondary" size="sm" onPress={() => { fetchPosDeliveries().then(setDeliveries).catch(() => Alert.alert('Liste alınamadı', 'Lütfen tekrar dene.')); }} />
              <Button label="Bağlantıyı sil" variant="danger" onPress={remove} loading={busy === 'delete'} disabled={!!busy} fullWidth />
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 18, color: t.heading, marginTop: 4 },
  lead: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: t.textSecondary },
  card: { borderRadius: 16, padding: 14, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: t.text },
  sub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: t.textSecondary },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: t.textSecondary },
  secretRow: { borderRadius: 10, padding: 10, gap: 4 },
  secretLabel: { fontFamily: fonts.bold, fontSize: 12, color: t.textSecondary },
  mono: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 17, color: t.text },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  switchText: { fontFamily: fonts.semibold, fontSize: 14, color: t.text },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1, minWidth: 0 },
});
