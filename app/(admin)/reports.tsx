import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { closeMessageReport, fetchMessageReports, type MessageReportRow } from '@/lib/messages';
import { fonts } from '@/lib/fonts';

export default function AdminReportsScreen() {
  const router = useRouter();
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
      Alert.alert('Kapatılamadı', 'Lütfen tekrar deneyin.');
    }
  };

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <Text style={st.headerTitle}>Bildirilen Mesajlar</Text>
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
          {rows.length === 0 && !failed && <Text style={st.empty}>Bildirilen mesaj yok.</Text>}
          {rows.map(r => (
            <View key={r.id} style={[st.card, r.status === 'closed' && st.cardClosed]}>
              <Text style={st.reason}>{r.reason}</Text>
              <Text style={st.body}>"{r.body_snapshot}"</Text>
              <Text style={st.sub}>Gönderen kullanıcı: {r.reported_user ?? 'silinmiş hesap'}</Text>
              <Text style={st.sub}>{new Date(r.created_at).toLocaleString('tr-TR')}</Text>
              {r.status === 'open' ? (
                <Pressable style={st.closeBtn} onPress={() => close(r.id)}>
                  <Text style={st.closeText}>İncelendi, kapat</Text>
                </Pressable>
              ) : (
                <Text style={st.closedText}>Kapatıldı</Text>
              )}
            </View>
          ))}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}
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
  card: { backgroundColor: '#1F2B24', borderRadius: 14, padding: 14, gap: 6 },
  cardClosed: { opacity: 0.55 },
  reason: { fontSize: 14, fontFamily: fonts.bold, color: '#FFB74D' },
  body: { fontFamily: fonts.regular, fontSize: 14, color: '#fff', lineHeight: 20 },
  sub: { fontFamily: fonts.regular, fontSize: 11, color: '#6B766F' },
  closeBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  closeText: { color: '#fff', fontSize: 13, fontFamily: fonts.bold },
  closedText: { fontSize: 12, fontFamily: fonts.semibold, color: '#6B766F' },
});
