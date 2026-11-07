import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { fetchConversations, useConversationChanges, type ChatRole, type ConversationRow } from '@/lib/messages';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';
import { TopBar } from '@/components/shared/TopBar';
import { LogoLoader } from '@/components/shared/Logo';

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
    <View style={[st.safe, { backgroundColor: t.background }]}>
      <TopBar back title="Mesajlar" />

      {loading ? (
        <View style={st.center}><LogoLoader /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={c => c.id}
          contentContainerStyle={rows.length === 0 ? st.emptyWrap : st.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          ListEmptyComponent={
            <View style={st.center}>
              <Ionicons name={failed ? 'alert-circle-outline' : 'chatbubbles-outline'} size={44} color={t.textMuted} />
              <Text style={[st.emptyText, { color: t.textSecondary }]}>
                {failed ? 'Mesajlar yüklenemedi. Aşağı çekip yenile.' : emptyText}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const unread = item.unread_count > 0;
            return (
              <Pressable
                style={[st.row, { backgroundColor: t.surface }]}
                onPress={() => router.push(`/chat/${item.id}` as any)}
                accessibilityRole="button"
                accessibilityLabel={`${item.other_name}${unread ? `, ${item.unread_count} okunmamış` : ''}`}
              >
                <View style={[st.avatar, { backgroundColor: unread ? t.accent : t.chip }]}>
                  <Text style={[st.avatarText, { color: unread ? t.onAccent : t.text }]}>{item.other_name.charAt(0).toLocaleUpperCase('tr-TR')}</Text>
                </View>
                <View style={st.rowBody}>
                  <View style={st.rowTop}>
                    <Text style={[st.name, { color: t.text, fontFamily: unread ? fonts.extrabold : fonts.semibold }]} numberOfLines={1}>{item.other_name}</Text>
                    <Text style={[st.time, { color: t.textSecondary }]}>{timeLabel(item.last_message_at)}</Text>
                  </View>
                  <View style={st.rowTop}>
                    <Text style={[st.preview, { color: t.textSecondary }]} numberOfLines={1}>
                      {item.blocked_by ? 'Engellendi' : item.last_message_preview ?? ''}
                    </Text>
                    {unread && (
                      <View style={[st.badge, { backgroundColor: t.brand }]}>
                        <Text style={[st.badgeText, { color: t.onBrand }]}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  emptyWrap: { flexGrow: 1 },
  emptyText: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  list: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontSize: 18, fontFamily: fonts.extrabold },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 14, flex: 1 },
  time: { fontFamily: fonts.regular, fontSize: 12 },
  preview: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, flex: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11, fontFamily: fonts.extrabold },
});
