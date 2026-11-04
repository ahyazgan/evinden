import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '@/lib/db';
import { fonts } from '@/lib/fonts';

type NotifType = 'order' | 'review' | 'system' | 'promo';

type DemoNotif = {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  time: string;
  read: boolean;
};

const NOTIF_ICONS: Record<NotifType, string> = {
  order: '📦',
  review: '⭐',
  system: '🔔',
  promo: '🎉',
};

const NOTIF_COLORS: Record<NotifType, string> = {
  order: '#E3F2FD',
  review: '#FFF8E1',
  system: '#F3E5F5',
  promo: '#E8F5E9',
};

function mapType(t: string): NotifType {
  if (t === 'order' || t === 'order_status') return 'order';
  if (t === 'review') return 'review';
  if (t === 'promo' || t === 'campaign') return 'promo';
  return 'system';
}

function formatTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin} dk önce`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} sa önce`;
  const diffDay = Math.floor(diffH / 24);
  if (diffDay === 1) return 'Dün';
  return `${diffDay} gün önce`;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [notifs, setNotifs] = useState<DemoNotif[]>([]);
  const [filter, setFilter] = useState<'all' | NotifType>('all');

  useEffect(() => {
    if (!session?.userId) return;
    fetchNotifications(session.userId)
      .then(rows => {
        setNotifs(rows.map(r => ({
          id: r.id,
          type: mapType(r.type),
          title: r.title,
          body: r.body ?? '',
          time: formatTime(r.created_at),
          read: r.is_read,
        })));
      })
      .catch(() => {});
  }, [session?.userId]);

  const unreadCount = notifs.filter((n) => !n.read).length;

  const markAllRead = () => {
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    if (session?.userId) {
      markAllNotificationsRead(session.userId).catch(() => {});
    }
  };

  const filtered = filter === 'all' ? notifs : notifs.filter((n) => n.type === filter);

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={20} color="#151A16" />
        </Pressable>
        <Text style={st.headerTitle}>Bildirimler</Text>
        {unreadCount > 0 ? (
          <Pressable onPress={markAllRead}>
            <Text style={st.markRead}>Tümünü oku</Text>
          </Pressable>
        ) : (
          <View style={{ width: 80 }} />
        )}
      </View>

      {/* Filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.filterRow}
        style={{ flexGrow: 0 }}
      >
        {([['all', 'Tümü'], ['order', '📦 Siparişler'], ['review', '⭐ Yorumlar'], ['system', '🔔 Sistem']] as [string, string][]).map(
          ([key, label]) => (
            <Pressable
              key={key}
              style={[st.filterPill, filter === key && st.filterPillActive]}
              onPress={() => setFilter(key as any)}
            >
              <Text style={[st.filterText, filter === key && st.filterTextActive]}>{label}</Text>
            </Pressable>
          ),
        )}
      </ScrollView>

      <ScrollView contentContainerStyle={st.list} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={st.empty}>
            <Text style={st.emptyEmoji}>🔕</Text>
            <Text style={st.emptyTitle}>Bildirim yok</Text>
            <Text style={st.emptySub}>Bu kategoride bildirim bulunmuyor.</Text>
          </View>
        ) : (
          filtered.map((n) => (
            <Pressable
              key={n.id}
              style={[st.notifCard, !n.read && st.notifCardUnread]}
              onPress={() => setNotifs((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x))}
            >
              <View style={[st.notifIcon, { backgroundColor: NOTIF_COLORS[n.type] }]}>
                <Text style={st.notifIconText}>{NOTIF_ICONS[n.type]}</Text>
              </View>
              <View style={st.notifBody}>
                <View style={st.notifTopRow}>
                  <Text style={[st.notifTitle, !n.read && st.notifTitleUnread]}>{n.title}</Text>
                  {!n.read && <View style={st.unreadDot} />}
                </View>
                <Text style={st.notifText} numberOfLines={2}>{n.body}</Text>
                <Text style={st.notifTime}>{n.time}</Text>
              </View>
            </Pressable>
          ))
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF8F2' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E3E6DE',
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EFF2EA', alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, fontFamily: fonts.display, color: '#151A16', marginTop: -2 },
  headerTitle: { fontSize: 18, fontFamily: fonts.display, color: '#151A16' },
  markRead: { fontSize: 13, color: colors.primary, fontFamily: fonts.bold },

  filterRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E3E6DE' },
  filterPillActive: { backgroundColor: '#17402F', borderColor: '#151A16' },
  filterText: { fontSize: 13, fontFamily: fonts.semibold, color: '#6B766F' },
  filterTextActive: { color: '#fff' },

  list: { padding: 16, gap: 8 },

  notifCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E3E6DE',
  },
  notifCardUnread: { backgroundColor: '#FAF8F2', borderColor: colors.primary + '40' },
  notifIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  notifIconText: { fontFamily: fonts.regular, fontSize: 20 },
  notifBody: { flex: 1, gap: 3 },
  notifTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notifTitle: { fontSize: 14, fontFamily: fonts.semibold, color: '#151A16' },
  notifTitleUnread: { fontFamily: fonts.extrabold },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  notifText: { fontFamily: fonts.regular, fontSize: 13, color: '#56605A', lineHeight: 18 },
  notifTime: { fontFamily: fonts.regular, fontSize: 11, color: '#6B766F', marginTop: 2 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyEmoji: { fontFamily: fonts.regular, fontSize: 52 },
  emptyTitle: { fontSize: 16, fontFamily: fonts.bold, color: '#151A16' },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: '#6B766F' },
});
