import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';

type OrderStatus = 'pending' | 'accepted' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

type DemoOrder = {
  id: string;
  seller_id: string;
  seller_name: string;
  seller_emoji: string;
  seller_bg: string;
  status: OrderStatus;
  created_at: string;
  total_cents: number;
  items: { title: string; quantity: number; price_cents: number }[];
  delivery_address: string;
};

const DEMO_ORDERS: DemoOrder[] = [
  {
    id: 'ord-1',
    seller_id: 'demo-1',
    seller_name: "Ayşe'nin Ev Yemekleri",
    seller_emoji: '🍲',
    seller_bg: '#FFF3E0',
    status: 'preparing',
    created_at: new Date(Date.now() - 20 * 60000).toISOString(),
    total_cents: 17500,
    items: [
      { title: 'Kuru Fasulye + Pilav', quantity: 1, price_cents: 8000 },
      { title: 'Mercimek Çorbası', quantity: 2, price_cents: 4500 },
      { title: 'Karışık Salata', quantity: 1, price_cents: 3500 },
    ],
    delivery_address: 'Moda Cad. 42, Kadıköy',
  },
  {
    id: 'ord-2',
    seller_id: 'demo-3',
    seller_name: 'Mehmet Usta Karadeniz',
    seller_emoji: '🐟',
    seller_bg: '#E3F2FD',
    status: 'delivered',
    created_at: new Date(Date.now() - 2 * 24 * 3600000).toISOString(),
    total_cents: 22500,
    items: [
      { title: 'Hamsi Tava', quantity: 1, price_cents: 11000 },
      { title: 'Kuymak', quantity: 1, price_cents: 8500 },
      { title: 'Mısır Ekmeği', quantity: 1, price_cents: 3000 },
    ],
    delivery_address: 'Moda Cad. 42, Kadıköy',
  },
  {
    id: 'ord-3',
    seller_id: 'demo-4',
    seller_name: 'Zeynep Pasta & Tatlı',
    seller_emoji: '🎂',
    seller_bg: '#FCE4EC',
    status: 'cancelled',
    created_at: new Date(Date.now() - 5 * 24 * 3600000).toISOString(),
    total_cents: 35000,
    items: [
      { title: 'Çikolatalı Yaş Pasta', quantity: 1, price_cents: 35000 },
    ],
    delivery_address: 'Moda Cad. 42, Kadıköy',
  },
];

const STATUS_CONFIG: Record<OrderStatus, { label: string; bg: string; text: string; icon: string }> = {
  pending:   { label: 'Bekliyor',       bg: '#FFF8E1', text: '#F57F17', icon: '⏳' },
  accepted:  { label: 'Kabul Edildi',   bg: '#E3F2FD', text: '#1565C0', icon: '✅' },
  preparing: { label: 'Hazırlanıyor',   bg: '#FFF8E1', text: '#E65100', icon: '👨‍🍳' },
  ready:     { label: 'Hazır',          bg: '#E8F5E9', text: '#2E7D32', icon: '🎉' },
  delivered: { label: 'Teslim Edildi',  bg: '#E8F5E9', text: '#2E7D32', icon: '✓' },
  cancelled: { label: 'İptal',          bg: '#F5F5F5', text: '#9E9E9E', icon: '✕' },
};

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffH / 24);

  if (diffMin < 60) return `${diffMin} dk önce`;
  if (diffH < 24) return `${diffH} saat önce`;
  if (diffDay === 1) return 'Dün';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
}

const FILTER_TABS: { key: 'all' | OrderStatus; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'preparing', label: 'Aktif' },
  { key: 'delivered', label: 'Teslim' },
  { key: 'cancelled', label: 'İptal' },
];

export default function CustomerOrdersScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'all' | OrderStatus>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [orders, setOrders] = useState<DemoOrder[]>(DEMO_ORDERS);
  const [ratingModal, setRatingModal] = useState<DemoOrder | null>(null);
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');

  const simulateNextStatus = (id: string, current: OrderStatus) => {
    const flow: OrderStatus[] = ['pending', 'accepted', 'preparing', 'ready', 'delivered'];
    const idx = flow.indexOf(current);
    if (idx > -1 && idx < flow.length - 1) {
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status: flow[idx + 1] } : o));
    }
  };

  const filtered = orders.filter(o => {
    if (activeTab === 'all') return true;
    if (activeTab === 'preparing') return ['pending', 'accepted', 'preparing', 'ready'].includes(o.status);
    return o.status === activeTab;
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Siparişlerim</Text>
        <Text style={styles.headerSub}>{orders.length} sipariş</Text>
      </View>

      {/* Filter tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabScroll}
        style={styles.tabRow}
      >
        {FILTER_TABS.map(tab => (
          <Pressable
            key={tab.key}
            style={[styles.tabPill, activeTab === tab.key && styles.tabPillActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📦</Text>
            <Text style={styles.emptyTitle}>Sipariş yok</Text>
            <Text style={styles.emptySub}>Bu kategoride sipariş bulunmuyor.</Text>
          </View>
        ) : (
          filtered.map(order => {
            const sc = STATUS_CONFIG[order.status];
            const isExpanded = expandedId === order.id;

            return (
              <Pressable
                key={order.id}
                style={styles.orderCard}
                onPress={() => setExpandedId(isExpanded ? null : order.id)}
              >
                {/* Top row */}
                <View style={styles.orderTop}>
                  <View style={[styles.orderEmoji, { backgroundColor: order.seller_bg }]}>
                    <Text style={styles.orderEmojiText}>{order.seller_emoji}</Text>
                  </View>
                  <View style={styles.orderInfo}>
                    <Text style={styles.orderSeller} numberOfLines={1}>{order.seller_name}</Text>
                    <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
                  </View>
                  <View style={styles.orderRight}>
                    <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.statusText, { color: sc.text }]}>
                        {sc.icon} {sc.label}
                      </Text>
                    </View>
                    <Text style={styles.orderTotal}>{priceTL(order.total_cents)}</Text>
                  </View>
                </View>

                {/* Expanded items */}
                {isExpanded ? (
                  <View style={styles.expandedWrap}>
                    <View style={styles.divider} />

                    {/* Timeline for active orders */}
                    {['pending', 'accepted', 'preparing', 'ready'].includes(order.status) ? (
                      <View style={styles.timelineBox}>
                        {(['pending', 'preparing', 'ready', 'delivered'] as OrderStatus[]).map((step, idx, arr) => {
                          const sMap: Record<string, string> = { pending: 'Bekliyor', preparing: 'Hazırlanıyor', ready: 'Yolda', delivered: 'Teslim' };
                          const currentIdx = arr.findIndex(s => s === order.status) || 0;
                          const mappedCurrent = currentIdx === -1 && order.status === 'accepted' ? 1 : Math.max(0, currentIdx);
                          const active = idx <= mappedCurrent;
                          const isLast = idx === arr.length - 1;
                          return (
                            <View key={step} style={styles.timelineItem}>
                              <View style={[styles.timelineDot, active && styles.timelineDotActive]} />
                              {!isLast && <View style={[styles.timelineLine, idx < mappedCurrent && styles.timelineLineActive]} />}
                              <Text style={[styles.timelineText, active && styles.timelineTextActive]}>{sMap[step]}</Text>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}

                    {order.items.map((item, idx) => (
                      <View key={idx} style={styles.itemRow}>
                        <Text style={styles.itemText}>
                          <Text style={styles.itemQty}>{item.quantity}×</Text> {item.title}
                        </Text>
                        <Text style={styles.itemPrice}>{priceTL(item.price_cents * item.quantity)}</Text>
                      </View>
                    ))}
                    <View style={styles.addressRow}>
                      <Text style={styles.addressText}>📍 {order.delivery_address}</Text>
                    </View>

                    {/* Action buttons */}
                    <View style={styles.actionRow}>
                      {['pending', 'accepted', 'preparing', 'ready'].includes(order.status) && (
                        <Pressable style={styles.simulateBtn} onPress={() => simulateNextStatus(order.id, order.status)}>
                          <Text style={styles.simulateBtnText}>Simüle Et (Siparişi İlerlet)</Text>
                        </Pressable>
                      )}
                      {order.status === 'delivered' ? (
                        <>
                          <Pressable
                            style={styles.reorderBtn}
                            onPress={() => router.push(`/(customer)/seller/${order.seller_id}` as any)}
                          >
                            <Text style={styles.reorderBtnText}>Tekrar Ver</Text>
                          </Pressable>
                          <Pressable
                            style={styles.reviewBtn}
                            onPress={() => { setRatingModal(order); setRating(0); setReview(''); }}
                          >
                            <Text style={styles.reviewBtnText}>Değerlendir</Text>
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  </View>
                ) : null}

                {/* Expand hint */}
                <Text style={styles.expandHint}>{isExpanded ? '▲ Kapat' : '▼ Detaylar'}</Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/* RATING MODAL */}
      <Modal visible={!!ratingModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Siparişi Değerlendir</Text>
            <Text style={styles.modalSub}>{ratingModal?.seller_name}</Text>
            
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map(star => (
                <Pressable key={star} onPress={() => setRating(star)}>
                  <Text style={[styles.starIcon, rating >= star && styles.starIconActive]}>★</Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={styles.reviewInput}
              value={review}
              onChangeText={setReview}
              placeholder="Yemekler nasıldı? Lütfen yorumunuzu yazın..."
              placeholderTextColor="#A89A8A"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <View style={styles.modalBtns}>
              <Pressable style={styles.modalCancel} onPress={() => setRatingModal(null)}>
                <Text style={styles.modalCancelText}>İptal</Text>
              </Pressable>
              <Pressable style={styles.modalSubmit} onPress={() => setRatingModal(null)}>
                <Text style={styles.modalSubmitText}>Gönder</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },

  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E2',
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1A1208', fontFamily: 'serif' },
  headerSub: { fontSize: 13, color: '#A89A8A', marginTop: 2 },

  tabRow: { flexGrow: 0 },
  tabScroll: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  tabPill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  tabPillActive: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#A89A8A' },
  tabTextActive: { color: '#fff' },

  list: { padding: 16, paddingBottom: 40, gap: 10 },

  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 14,
  },
  orderTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orderEmoji: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  orderEmojiText: { fontSize: 24 },
  orderInfo: { flex: 1 },
  orderSeller: { fontSize: 14, fontWeight: '700', color: '#1A1208', marginBottom: 2 },
  orderDate: { fontSize: 12, color: '#A89A8A' },
  orderRight: { alignItems: 'flex-end', gap: 4 },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  orderTotal: { fontSize: 14, fontWeight: '800', color: colors.primary },

  expandedWrap: { marginTop: 10 },
  divider: { height: 1, backgroundColor: '#EDE8E2', marginBottom: 10 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  itemQty: { fontWeight: '700', color: '#1A1208' },
  itemText: { fontSize: 13, color: '#6B5E50', flex: 1 },
  itemPrice: { fontSize: 13, fontWeight: '700', color: '#1A1208' },
  addressRow: { marginTop: 6 },
  addressText: { fontSize: 12, color: '#A89A8A' },
  reorderBtn: {
    marginTop: 12,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  reorderBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  expandHint: { fontSize: 11, color: '#C4B8AA', textAlign: 'center', marginTop: 10 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1A1208' },
  emptySub: { fontSize: 13, color: '#A89A8A' },

  timelineBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 10,
  },
  timelineItem: { alignItems: 'center', position: 'relative', flex: 1 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#E8E2DA', zIndex: 2 },
  timelineDotActive: { backgroundColor: colors.primary },
  timelineLine: { position: 'absolute', top: 5, left: '50%', width: '100%', height: 2, backgroundColor: '#E8E2DA', zIndex: 1 },
  timelineLineActive: { backgroundColor: colors.primary },
  timelineText: { fontSize: 10, color: '#A89A8A', marginTop: 6, fontWeight: '600', textAlign: 'center' },
  timelineTextActive: { color: colors.primary, fontWeight: '700' },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  simulateBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#FFF8E1', borderWidth: 1, borderColor: '#FFE082', alignItems: 'center' },
  simulateBtnText: { fontSize: 13, fontWeight: '700', color: '#F57F17' },
  reviewBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center' },
  reviewBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208', marginBottom: 4 },
  modalSub: { fontSize: 14, color: '#A89A8A', marginBottom: 20 },
  starsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  starIcon: { fontSize: 40, color: '#E8E2DA' },
  starIconActive: { color: '#EF9F27' },
  reviewInput: { width: '100%', backgroundColor: '#FAF7F2', borderRadius: 12, padding: 14, fontSize: 14, color: '#1A1208', minHeight: 80, borderWidth: 1, borderColor: '#F0ECE6', marginBottom: 20 },
  modalBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  modalCancel: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#F5F0EA' },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: '#6B5E50' },
  modalSubmit: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: colors.primary },
  modalSubmitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
