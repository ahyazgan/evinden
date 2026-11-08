import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { TopBar, TopIconButton } from '@/components/shared/TopBar';
import { useAuth } from '@/lib/auth-context';
import { deleteNotification, fetchNotifications, markNotificationRead, markAllNotificationsRead } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';
import { notificationRoute } from '@/lib/notification-route';

type NotifType = 'order' | 'review' | 'system' | 'promo';

type DemoNotif = {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  time: string;
  read: boolean;
  rawType: string;
  data: Record<string, unknown> | null;
};

type IconName = keyof typeof Ionicons.glyphMap;

const NOTIF_ICONS: Record<NotifType, IconName> = {
  order: 'receipt-outline',
  review: 'star-outline',
  system: 'notifications-outline',
  promo: 'pricetag-outline',
};

const FILTERS: { key: 'all' | NotifType; label: string; icon?: IconName }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'order', label: 'Siparişler', icon: NOTIF_ICONS.order },
  { key: 'review', label: 'Yorumlar', icon: NOTIF_ICONS.review },
  { key: 'system', label: 'Sistem', icon: NOTIF_ICONS.system },
];

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
  const { colors: t } = useTheme();
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
          rawType: r.type,
          data: r.data,
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
    <View style={[st.safe, { backgroundColor: t.background }]}>
      <TopBar
        title="Bildirimler"
        subtitle={unreadCount > 0 ? `${unreadCount} okunmamış` : undefined}
        back
        right={unreadCount > 0 ? <TopIconButton icon="checkmark-done" label="Tümünü okundu işaretle" onPress={markAllRead} /> : undefined}
      />

      {/* Filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.filterRow}
        style={st.noGrow}
      >
        {FILTERS.map(({ key, label, icon }) => {
          const on = filter === key;
          return (
            <Pressable
              key={key}
              style={[st.chip, { backgroundColor: on ? t.brand : t.surface }]}
              hitSlop={2}
              onPress={() => setFilter(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              {icon ? <Ionicons name={icon} size={16} color={on ? t.onBrand : t.text} /> : null}
              <Text style={[st.chipText, { color: on ? t.onBrand : t.text }]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={st.list} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="notifications-off-outline" size={44} color={t.textMuted} />
            <Text style={[st.emptyTitle, { color: t.heading }]}>Bildirim yok</Text>
            <Text style={[st.emptySub, { color: t.textSecondary }]}>Bu kategoride bildirim bulunmuyor.</Text>
          </View>
        ) : (
          filtered.map((n) => (
            <Pressable
              key={n.id}
              style={[st.notifCard, { backgroundColor: t.surface }]}
              accessibilityRole="button"
              accessibilityLabel={`${n.read ? '' : 'Okunmamış. '}${n.title}. ${n.body}`}
              accessibilityHint="Silmek için basılı tut"
              onPress={() => {
                if (!n.read) {
                  setNotifs((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x));
                  markNotificationRead(n.id).catch(() => {});
                }
                const route = notificationRoute(n.rawType, n.data, 'seller');
                if (route) router.push(route as any);
              }}
              onLongPress={() => {
                Alert.alert('Bildirimi sil', 'Bu bildirim silinsin mi?', [
                  { text: 'Vazgeç', style: 'cancel' },
                  {
                    text: 'Sil',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await deleteNotification(n.id);
                        setNotifs((prev) => prev.filter((x) => x.id !== n.id));
                      } catch {
                        Alert.alert('Silinemedi', 'Lütfen tekrar dene.');
                      }
                    },
                  },
                ]);
              }}
            >
              <View style={[st.notifIcon, { backgroundColor: t.background }]}>
                <Ionicons name={NOTIF_ICONS[n.type]} size={20} color={t.text} />
              </View>
              <View style={st.notifBody}>
                <View style={st.notifTopRow}>
                  <Text style={[st.notifTitle, { color: t.text }, !n.read && st.notifTitleUnread]}>{n.title}</Text>
                  {!n.read && <View style={[st.unreadDot, { backgroundColor: t.brand }]} />}
                </View>
                <Text style={[st.notifText, { color: t.textSecondary }]} numberOfLines={2}>{n.body}</Text>
                <Text style={[st.notifTime, { color: t.textSecondary }]}>{n.time}</Text>
              </View>
            </Pressable>
          ))
        )}
        <View style={st.bottomSpace} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  noGrow: { flexGrow: 0 },
  bottomSpace: { height: 20 },

  filterRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  chipText: { fontSize: 13, fontFamily: fonts.bold },

  list: { paddingHorizontal: 16, gap: 10 },

  notifCard: { flexDirection: 'row', gap: 12, borderRadius: 16, padding: 12 },
  notifIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  notifBody: { flex: 1, minWidth: 0, gap: 3 },
  notifTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notifTitle: { flexShrink: 1, fontSize: 14, fontFamily: fonts.semibold },
  notifTitleUnread: { fontFamily: fonts.extrabold },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  notifText: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular },
  notifTime: { fontSize: 12, fontFamily: fonts.regular, marginTop: 2 },

  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
  emptySub: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, textAlign: 'center' },
});
