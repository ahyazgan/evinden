import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { fetchConversations, useConversationChanges, type ChatRole, type ConversationRow } from '@/lib/messages';
import { useTheme } from '@/lib/theme-context';

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Dün';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
}

export function ConversationList({ role, emptyText }: { role: ChatRole; emptyText: string }) {
  const router = useRouter();
  const { session } = useAuth();
  const { colors: t } = useTheme();
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await fetchConversations(role));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [role]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useConversationChanges(!!session, load);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: t.background }]} edges={['top']}>
      <View style={[st.header, { borderBottomColor: t.surfaceBorder }]}>
        <Pressable style={[st.backBtn, { backgroundColor: t.surface }]} onPress={() => router.back()} hitSlop={12}>
          <Text style={[st.backIcon, { color: t.text }]}>‹</Text>
        </Pressable>
        <Text style={[st.headerTitle, { color: t.text }]}>Mesajlar</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={st.center}><ActivityIndicator color={t.primary} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={c => c.id}
          contentContainerStyle={rows.length === 0 ? st.emptyWrap : undefined}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          ListEmptyComponent={
            <View style={st.center}>
              <Text style={st.emptyEmoji}>{failed ? '⚠️' : '💬'}</Text>
              <Text style={[st.emptyText, { color: t.textMuted }]}>
                {failed ? 'Mesajlar yüklenemedi. Aşağı çekip yenileyin.' : emptyText}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={[st.row, { borderBottomColor: t.surfaceBorder, backgroundColor: t.surface }]}
              onPress={() => router.push(`/chat/${item.id}` as any)}
            >
              <View style={[st.avatar, { backgroundColor: t.background }]}>
                <Text style={[st.avatarText, { color: t.primary }]}>{item.other_name.charAt(0).toLocaleUpperCase('tr-TR')}</Text>
              </View>
              <View style={st.rowBody}>
                <View style={st.rowTop}>
                  <Text style={[st.name, { color: t.text }]} numberOfLines={1}>{item.other_name}</Text>
                  <Text style={[st.time, { color: t.textMuted }]}>{timeLabel(item.last_message_at)}</Text>
                </View>
                <View style={st.rowTop}>
                  <Text style={[st.preview, { color: t.textMuted }]} numberOfLines={1}>
                    {item.blocked_by ? 'Engellendi' : item.last_message_preview ?? ''}
                  </Text>
                  {item.unread_count > 0 && (
                    <View style={[st.badge, { backgroundColor: t.primary }]}>
                      <Text style={st.badgeText}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, fontWeight: '700', marginTop: -2 },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  emptyWrap: { flexGrow: 1 },
  emptyEmoji: { fontSize: 44 },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  row: { flexDirection: 'row', gap: 12, padding: 14, borderBottomWidth: 1, alignItems: 'center' },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '800' },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 15, fontWeight: '700', flex: 1 },
  time: { fontSize: 11 },
  preview: { fontSize: 13, flex: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
