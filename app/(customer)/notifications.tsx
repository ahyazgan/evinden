import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { useTheme } from '@/lib/theme-context';

type NotifType = 'order' | 'promo' | 'system';

type Notif = {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  time: string;
  read: boolean;
};

const ICONS: Record<NotifType, { name: string; color: string }> = {
  order: { name: 'cube-outline', color: '#1565C0' },
  promo: { name: 'pricetag-outline', color: '#E65100' },
  system: { name: 'notifications-outline', color: '#7B1FA2' },
};

const ICON_BG: Record<NotifType, string> = {
  order: '#E3F2FD',
  promo: '#FFF3E0',
  system: '#F3E5F5',
};

const DEMO: Notif[] = [
  { id: 'n1', type: 'order', title: 'Siparişiniz Hazırlanıyor', body: "Ayşe'nin Ev Yemekleri siparişinizi hazırlıyor. Tahmini süre: 25-35 dk.", time: '5 dk önce', read: false },
  { id: 'n2', type: 'promo', title: '%20 İndirim Fırsatı!', body: 'EVINDEN20 koduyla ilk siparişinize %20 indirim kazanın. Son gün: 5 Nisan.', time: '1 sa önce', read: false },
  { id: 'n3', type: 'order', title: 'Sipariş Teslim Edildi', body: 'Mehmet Usta Karadeniz siparişiniz teslim edildi. Afiyet olsun! Değerlendirme yapmayı unutmayın.', time: '2 sa önce', read: true },
  { id: 'n4', type: 'system', title: 'Hoş Geldiniz!', body: "evinden'e hoş geldiniz. Yakınındaki ev mutfaklarını keşfedin ve ilk siparişinizi verin.", time: 'Dün', read: true },
  { id: 'n5', type: 'promo', title: 'Ücretsiz Teslimat', body: '₺150 üzeri siparişlerde teslimat ücretsiz! Kod: UCRETSIZ', time: 'Dün', read: true },
  { id: 'n6', type: 'order', title: 'Siparişiniz İptal Edildi', body: 'Zeynep Pasta & Tatlı siparişiniz satıcı tarafından iptal edildi. Ödemeniz iade edildi.', time: '3 gün önce', read: true },
  { id: 'n7', type: 'promo', title: 'Hafta Sonu Lezzetleri', body: 'Bu hafta sonu özel menüler sizi bekliyor! 6 farklı mutfaktan taze yemekler.', time: '4 gün önce', read: true },
  { id: 'n8', type: 'system', title: 'Uygulama Güncellendi', body: 'Yeni özellikler: Dark mode, arama geçmişi, favori satıcılar ve daha fazlası.', time: '1 hafta önce', read: true },
];

const FILTER_TABS: { key: 'all' | NotifType; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'order', label: 'Siparişler' },
  { key: 'promo', label: 'Kampanyalar' },
  { key: 'system', label: 'Sistem' },
];

export default function CustomerNotificationsScreen() {
  const router = useRouter();
  const { colors: t } = useTheme();
  const [notifs, setNotifs] = useState(DEMO);
  const [activeTab, setActiveTab] = useState<'all' | NotifType>('all');
  const [refreshing, setRefreshing] = useState(false);

  const unreadCount = notifs.filter(n => !n.read).length;

  const markAllRead = () => setNotifs(prev => prev.map(n => ({ ...n, read: true })));

  const deleteNotif = (id: string) => {
    Alert.alert('Bildirimi Sil', 'Bu bildirimi silmek istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => setNotifs(prev => prev.filter(n => n.id !== id)) },
    ]);
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const filtered = notifs.filter(n => activeTab === 'all' || n.type === activeTab);

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Header */}
      <View style={[st.header, { borderBottomColor: t.surfaceBorder }]}>
        <Pressable style={[st.backBtn, { backgroundColor: t.inputBg }]} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color={t.text} />
        </Pressable>
        <View style={st.headerCenter}>
          <Text style={[st.headerTitle, { color: t.text }]}>Bildirimler</Text>
          {unreadCount > 0 && (
            <View style={st.unreadBadge}>
              <Text style={st.unreadBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        {unreadCount > 0 ? (
          <Pressable onPress={markAllRead}>
            <Text style={st.markRead}>Tümünü oku</Text>
          </Pressable>
        ) : (
          <View style={{ width: 80 }} />
        )}
      </View>

      {/* Filter Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabScroll} style={st.tabRow}>
        {FILTER_TABS.map(tab => (
          <Pressable
            key={tab.key}
            style={[st.tabPill, activeTab === tab.key && st.tabPillActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[st.tabText, activeTab === tab.key && st.tabTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={st.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {filtered.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="notifications-off-outline" size={56} color={t.textMuted} />
            <Text style={[st.emptyTitle, { color: t.text }]}>Bildirim yok</Text>
            <Text style={[st.emptySub, { color: t.textMuted }]}>
              {activeTab === 'all' ? 'Henüz bildiriminiz bulunmuyor.' : 'Bu kategoride bildirim bulunmuyor.'}
            </Text>
          </View>
        ) : (
          filtered.map(n => {
            const iconCfg = ICONS[n.type];
            return (
              <Pressable
                key={n.id}
                style={[st.card, { backgroundColor: t.surface, borderColor: t.surfaceBorder }, !n.read && st.cardUnread]}
                onPress={() => setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x))}
                onLongPress={() => deleteNotif(n.id)}
              >
                <View style={[st.icon, { backgroundColor: ICON_BG[n.type] }]}>
                  <Ionicons name={iconCfg.name as any} size={22} color={iconCfg.color} />
                </View>
                <View style={st.body}>
                  <View style={st.topRow}>
                    <Text style={[st.title, { color: t.text }, !n.read && st.titleUnread]} numberOfLines={1}>{n.title}</Text>
                    {!n.read && <View style={st.dot} />}
                  </View>
                  <Text style={[st.text, { color: t.textSecondary }]} numberOfLines={2}>{n.body}</Text>
                  <Text style={[st.time, { color: t.textMuted }]}>{n.time}</Text>
                </View>
              </Pressable>
            );
          })
        )}

        {filtered.length > 0 && (
          <View style={st.tip}>
            <Ionicons name="trash-outline" size={14} color={t.textMuted} />
            <Text style={[st.tipText, { color: t.textMuted }]}>Silmek için basılı tutun</Text>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  unreadBadge: { backgroundColor: colors.primary, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  markRead: { fontSize: 13, color: colors.primary, fontWeight: '700' },

  tabRow: { flexGrow: 0 },
  tabScroll: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  tabPill: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: '#F5F0EA', borderWidth: 1, borderColor: '#EDE8E2' },
  tabPillActive: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#A89A8A' },
  tabTextActive: { color: '#fff' },

  list: { padding: 16, gap: 8 },
  card: { flexDirection: 'row', gap: 12, borderRadius: 16, padding: 14, borderWidth: 1 },
  cardUnread: { borderColor: colors.primary + '40' },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  body: { flex: 1, gap: 3 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontWeight: '600', flex: 1 },
  titleUnread: { fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, flexShrink: 0 },
  text: { fontSize: 13, lineHeight: 18 },
  time: { fontSize: 11, marginTop: 2 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '800' },
  emptySub: { fontSize: 13, textAlign: 'center' },

  tip: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tipText: { fontSize: 12 },
});
