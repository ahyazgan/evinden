import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';

type NotifType = 'order' | 'promo' | 'system';

type Notif = {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  time: string;
  read: boolean;
};

const ICONS: Record<NotifType, string> = { order: '📦', promo: '🎉', system: '🔔' };
const COLORS: Record<NotifType, string> = { order: '#E3F2FD', promo: '#FFF8E1', system: '#F3E5F5' };

const DEMO: Notif[] = [
  { id: 'n1', type: 'order', title: 'Siparişiniz Hazırlanıyor', body: "Ayşe'nin Ev Yemekleri siparişinizi hazırlıyor.", time: '5 dk önce', read: false },
  { id: 'n2', type: 'promo', title: '%20 İndirim Fırsatı!', body: 'EVINDEN20 koduyla ilk siparişinize %20 indirim kazanın.', time: '1 sa önce', read: false },
  { id: 'n3', type: 'order', title: 'Sipariş Teslim Edildi', body: 'Mehmet Usta Karadeniz siparişiniz teslim edildi. Afiyet olsun!', time: '2 sa önce', read: true },
  { id: 'n4', type: 'system', title: 'Hoş Geldiniz!', body: "evinden'e hoş geldiniz. Yakınındaki ev mutfaklarını keşfedin.", time: 'Dün', read: true },
  { id: 'n5', type: 'promo', title: 'Ücretsiz Teslimat', body: '₺150 üzeri siparişlerde teslimat ücretsiz!', time: 'Dün', read: true },
  { id: 'n6', type: 'order', title: 'Siparişiniz İptal Edildi', body: 'Zeynep Pasta & Tatlı siparişiniz satıcı tarafından iptal edildi.', time: '3 gün önce', read: true },
];

export default function CustomerNotificationsScreen() {
  const router = useRouter();
  const [notifs, setNotifs] = useState(DEMO);

  const unreadCount = notifs.filter(n => !n.read).length;

  const markAllRead = () => setNotifs(prev => prev.map(n => ({ ...n, read: true })));

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Text style={st.backIcon}>‹</Text>
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

      <ScrollView contentContainerStyle={st.list} showsVerticalScrollIndicator={false}>
        {notifs.length === 0 ? (
          <View style={st.empty}>
            <Text style={st.emptyEmoji}>🔕</Text>
            <Text style={st.emptyTitle}>Bildirim yok</Text>
          </View>
        ) : (
          notifs.map(n => (
            <Pressable
              key={n.id}
              style={[st.card, !n.read && st.cardUnread]}
              onPress={() => setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x))}
            >
              <View style={[st.icon, { backgroundColor: COLORS[n.type] }]}>
                <Text style={st.iconText}>{ICONS[n.type]}</Text>
              </View>
              <View style={st.body}>
                <View style={st.topRow}>
                  <Text style={[st.title, !n.read && st.titleUnread]}>{n.title}</Text>
                  {!n.read && <View style={st.dot} />}
                </View>
                <Text style={st.text} numberOfLines={2}>{n.body}</Text>
                <Text style={st.time}>{n.time}</Text>
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
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EDE8E2' },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F0EA', alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, fontWeight: '700', color: '#1A1208', marginTop: -2 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208' },
  markRead: { fontSize: 13, color: colors.primary, fontWeight: '700' },
  list: { padding: 16, gap: 8 },
  card: { flexDirection: 'row', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#EDE8E2' },
  cardUnread: { backgroundColor: '#FFFBF7', borderColor: colors.primary + '40' },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  iconText: { fontSize: 20 },
  body: { flex: 1, gap: 3 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontWeight: '600', color: '#1A1208' },
  titleUnread: { fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  text: { fontSize: 13, color: '#6B5E50', lineHeight: 18 },
  time: { fontSize: 11, color: '#A89A8A', marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1A1208' },
});
