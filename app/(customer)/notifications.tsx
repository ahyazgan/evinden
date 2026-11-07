import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead , deleteNotification } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { notificationRoute, notificationRoleOf } from '@/lib/notification-route';
import { TopBar, TopIconButton } from '@/components/shared/TopBar';

type NotifType = 'order' | 'promo' | 'system';

type Notif = {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  time: string;
  read: boolean;
  rawType: string;
  data: Record<string, unknown> | null;
};

const ICONS: Record<NotifType, keyof typeof Ionicons.glyphMap> = {
  order: 'cube-outline',
  promo: 'pricetag-outline',
  system: 'notifications-outline',
};

const FILTER_TABS: { key: 'all' | NotifType; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'order', label: 'Siparişler' },
  { key: 'promo', label: 'Kampanyalar' },
  { key: 'system', label: 'Sistem' },
];

function mapNotifType(type: string): NotifType {
  if (type === 'order' || type === 'order_status') return 'order';
  if (type === 'promo' || type === 'campaign') return 'promo';
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
  if (diffDay < 7) return `${diffDay} gün önce`;
  return `${Math.floor(diffDay / 7)} hafta önce`;
}

export default function CustomerNotificationsScreen() {
  const router = useRouter();
  const { colors: t } = useTheme();
  const { session, profile } = useAuth();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | NotifType>('all');
  const [refreshing, setRefreshing] = useState(false);

  const loadNotifications = useCallback(async () => {
    if (!session?.userId) return;
    try {
      const rows = await fetchNotifications(session.userId);
      {
        setNotifs(rows.map(r => ({
          id: r.id,
          type: mapNotifType(r.type),
          title: r.title,
          body: r.body ?? '',
          time: formatTime(r.created_at),
          read: r.is_read,
          rawType: r.type,
          data: r.data,
        })));
      }
    } catch {
      // Keep demo data as fallback
    }
  }, [session?.userId]);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  const unreadCount = notifs.filter(n => !n.read).length;

  const markAllRead = async () => {
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    if (session?.userId) {
      markAllNotificationsRead(session.userId).catch(() => {});
    }
  };

  const deleteNotif = (id: string) => {
    Alert.alert('Bildirimi sil', 'Bu bildirim silinsin mi?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteNotification(id);
            setNotifs(prev => prev.filter(n => n.id !== id));
          } catch {
            Alert.alert('Silinemedi', 'Lütfen tekrar dene.');
          }
        },
      },
    ]);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadNotifications();
    setRefreshing(false);
  }, [loadNotifications]);

  const filtered = notifs.filter(n => activeTab === 'all' || n.type === activeTab);

  return (
    <View style={[st.safe, { backgroundColor: t.background }]}>
      <TopBar
        back
        title="Bildirimler"
        subtitle={unreadCount > 0 ? `${unreadCount} okunmamış` : undefined}
        right={unreadCount > 0 ? <TopIconButton icon="checkmark-done-outline" label="Tümünü okundu say" onPress={markAllRead} /> : undefined}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabScroll} style={st.tabRow}>
        {FILTER_TABS.map(tab => {
          const on = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[st.tabPill, { backgroundColor: on ? t.brand : t.surface }]}
              onPress={() => setActiveTab(tab.key)}
              hitSlop={{ top: 2, bottom: 2 }}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[st.tabText, { color: on ? t.onBrand : t.text }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={st.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} colors={[t.primary]} />
        }
      >
        {filtered.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="notifications-off-outline" size={44} color={t.textMuted} />
            <Text style={[st.emptyTitle, { color: t.heading }]}>Bildirim yok</Text>
            <Text style={[st.emptySub, { color: t.textSecondary }]}>
              {activeTab === 'all' ? 'Henüz bildirimin yok.' : 'Bu kategoride bildirim bulunmuyor.'}
            </Text>
          </View>
        ) : (
          filtered.map(n => (
            <Pressable
              key={n.id}
              style={[st.card, { backgroundColor: t.surface }]}
              onPress={() => {
                if (!n.read) {
                  setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
                  markNotificationRead(n.id).catch(() => {});
                }
                const route = notificationRoute(n.rawType, n.data, notificationRoleOf(profile?.role));
                if (route) router.push(route as any);
              }}
              onLongPress={() => deleteNotif(n.id)}
              accessibilityRole="button"
              accessibilityLabel={`${n.read ? '' : 'Okunmamış. '}${n.title}. ${n.body}. ${n.time}`}
              accessibilityHint="Silmek için basılı tut"
            >
              <View style={[st.icon, { backgroundColor: n.read ? t.chip : t.accent }]}>
                <Ionicons name={ICONS[n.type]} size={20} color={n.read ? t.text : t.onAccent} />
              </View>
              <View style={st.body}>
                <Text style={[st.title, { color: t.text, fontFamily: n.read ? fonts.semibold : fonts.extrabold }]} numberOfLines={1}>{n.title}</Text>
                <Text style={[st.text, { color: t.textSecondary }]} numberOfLines={2}>{n.body}</Text>
                <Text style={[st.time, { color: t.textSecondary }]}>{n.time}</Text>
              </View>
            </Pressable>
          ))
        )}

        {filtered.length > 0 && (
          <View style={st.tip}>
            <Ionicons name="trash-outline" size={14} color={t.textMuted} />
            <Text style={[st.tipText, { color: t.textMuted }]}>Silmek için basılı tut</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },

  tabRow: { flexGrow: 0 },
  tabScroll: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4, gap: 8 },
  tabPill: { height: 40, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 13, fontFamily: fonts.bold },

  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 10 },
  card: { flexDirection: 'row', gap: 12, borderRadius: 16, padding: 12 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 14 },
  text: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginTop: 2 },
  time: { fontFamily: fonts.regular, fontSize: 12, marginTop: 4 },

  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },

  tip: { marginTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tipText: { fontFamily: fonts.regular, fontSize: 12 },
});
