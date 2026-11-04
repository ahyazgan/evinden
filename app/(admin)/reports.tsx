import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { closeMessageReport, fetchMessageReports, type MessageReportRow } from '@/lib/messages';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

export default function AdminReportsScreen() {
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
  const [rows, setRows] = useState<MessageReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await fetchMessageReports());
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

  const close = async (id: string) => {
    try {
      await closeMessageReport(id);
      setRows(prev => prev.map(r => (r.id === id ? { ...r, status: 'closed' } : r)));
    } catch {
      Alert.alert('Kapatılamadı', 'Lütfen tekrar dene.');
    }
  };

  return (
    <View style={st.safe}>
      <TopBar title="Bildirilen mesajlar" back />

      {loading ? (
        <View style={st.center}><ActivityIndicator color={t.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={st.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
        >
          {failed && <Text style={st.error}>Veriler yüklenemedi. Aşağı çekip yenile.</Text>}
          {rows.length === 0 && !failed && <Text style={st.empty}>Bildirilen mesaj yok.</Text>}
          {rows.map(r => (
            <View key={r.id} style={[st.card, r.status === 'closed' && st.cardClosed]}>
              <Text style={st.reason}>{r.reason}</Text>
              <Text style={st.body}>"{r.body_snapshot}"</Text>
              <Text style={st.sub}>Gönderen kullanıcı: {r.reported_user ?? 'silinmiş hesap'}</Text>
              <Text style={st.sub}>{new Date(r.created_at).toLocaleString('tr-TR')}</Text>
              {r.status === 'open' ? (
                <View style={st.action}>
                  <Button label="İncelendi, kapat" onPress={() => close(r.id)} fullWidth />
                </View>
              ) : (
                <Text style={st.closedText}>Kapatıldı</Text>
              )}
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
  scroll: { padding: 16, gap: 10 },
  error: { fontFamily: fonts.semibold, fontSize: 13, color: t.danger, textAlign: 'center' },
  empty: { fontFamily: fonts.regular, fontSize: 14, color: t.textSecondary, textAlign: 'center', marginTop: 16 },
  card: { backgroundColor: t.surface, borderRadius: 16, padding: 14, gap: 6 },
  cardClosed: { opacity: 0.7 },
  reason: { fontSize: 14, fontFamily: fonts.bold, color: t.text },
  body: { fontFamily: fonts.regular, fontSize: 14, color: t.text, lineHeight: 20 },
  sub: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary },
  action: { marginTop: 4 },
  closedText: { fontSize: 12, fontFamily: fonts.semibold, color: t.textSecondary, marginTop: 2 },
});
