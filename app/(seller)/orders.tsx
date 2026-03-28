import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import type { Order, OrderStatus, Seller } from '@/types';

type OrderWithItems = Order & {
  order_items: { title_snapshot: string; quantity: number; unit_price_cents: number }[];
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Bekliyor',
  accepted: 'Kabul Edildi',
  preparing: 'Hazırlanıyor',
  ready: 'Hazır',
  out_for_delivery: 'Yolda',
  delivered: 'Teslim Edildi',
  cancelled: 'İptal',
};

const STATUS_COLOR: Record<OrderStatus, { bg: string; text: string }> = {
  pending: { bg: '#FFF3CD', text: '#856404' },
  accepted: { bg: '#CCE5FF', text: '#004085' },
  preparing: { bg: '#FFF3CD', text: '#856404' },
  ready: { bg: '#D4EDDA', text: '#155724' },
  out_for_delivery: { bg: '#D1ECF1', text: '#0C5460' },
  delivered: { bg: '#D4EDDA', text: '#155724' },
  cancelled: { bg: '#E9ECEF', text: '#6C757D' },
};

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: 'accepted',
  accepted: 'preparing',
  preparing: 'ready',
  ready: 'delivered',
};

const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  pending: 'Kabul Et',
  accepted: 'Hazırlanıyor',
  preparing: 'Hazır',
  ready: 'Teslim Edildi',
};

const FILTER_TABS: { label: string; statuses: OrderStatus[] }[] = [
  { label: 'Aktif', statuses: ['pending', 'accepted', 'preparing', 'ready'] },
  { label: 'Teslim', statuses: ['delivered', 'out_for_delivery'] },
  { label: 'İptal', statuses: ['cancelled'] },
  { label: 'Tümü', statuses: [] },
];

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

export default function SellerOrdersScreen() {
  const { profile } = useAuth();
  const [seller, setSeller] = useState<Seller | null>(null);
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterIdx, setFilterIdx] = useState(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const loadSeller = useCallback(async () => {
    if (!profile) return null;
    const { data } = await supabase
      .from('sellers')
      .select('*')
      .eq('user_id', profile.id)
      .maybeSingle();
    const sp = (data as Seller) ?? null;
    setSeller(sp);
    return sp;
  }, [profile]);

  const loadOrders = useCallback(async (sp: Seller) => {
    const { data } = await supabase
      .from('orders')
      .select(
        'id, customer_id, seller_id, status, subtotal_cents, delivery_fee_cents, total_cents, currency, delivery_address, notes, created_at, updated_at, order_items(title_snapshot, quantity, unit_price_cents)',
      )
      .eq('seller_id', sp.id)
      .order('created_at', { ascending: false })
      .limit(60);
    setOrders((data as OrderWithItems[]) ?? []);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const sp = await loadSeller();
      if (!mounted || !sp) {
        setLoading(false);
        return;
      }
      await loadOrders(sp);
      setLoading(false);

      // Realtime abonelik
      channelRef.current = supabase
        .channel(`seller-orders-${sp.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'orders', filter: `seller_id=eq.${sp.id}` },
          () => { loadOrders(sp); },
        )
        .subscribe();
    })();

    return () => {
      mounted = false;
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [loadSeller, loadOrders]);

  const onRefresh = useCallback(async () => {
    if (!seller) return;
    setRefreshing(true);
    await loadOrders(seller);
    setRefreshing(false);
  }, [seller, loadOrders]);

  const updateStatus = useCallback(
    async (order: OrderWithItems, newStatus: OrderStatus) => {
      const { error } = await supabase
        .from('orders')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', order.id);
      if (!error) {
        setOrders(prev =>
          prev.map(o => (o.id === order.id ? { ...o, status: newStatus } : o)),
        );
      } else {
        Alert.alert('Hata', error.message);
      }
    },
    [],
  );

  const cancelOrder = useCallback((order: OrderWithItems) => {
    Alert.alert('Siparişi İptal Et', 'Müşteriye bildirim gönderilecek.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'İptal Et',
        style: 'destructive',
        onPress: () => updateStatus(order, 'cancelled'),
      },
    ]);
  }, [updateStatus]);

  const filteredOrders = (() => {
    const tab = FILTER_TABS[filterIdx];
    if (tab.statuses.length === 0) return orders;
    return orders.filter(o => (tab.statuses as string[]).includes(o.status));
  })();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!seller) {
    return (
      <View style={styles.center}>
        <Text style={styles.infoText}>Önce Panel sekmesinden mağazanı oluştur.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Siparişler</Text>
      </View>

      {/* Filtre sekmeleri */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBar}
      >
        {FILTER_TABS.map((tab, idx) => (
          <Pressable
            key={tab.label}
            style={[styles.filterTab, filterIdx === idx && styles.filterTabActive]}
            onPress={() => setFilterIdx(idx)}
          >
            <Text
              style={[styles.filterTabText, filterIdx === idx && styles.filterTabTextActive]}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        data={filteredOrders}
        keyExtractor={o => o.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => {
          const statusStyle = STATUS_COLOR[item.status];
          const nextStatus = NEXT_STATUS[item.status];
          const nextLabel = NEXT_LABEL[item.status];

          return (
            <View style={styles.orderCard}>
              {/* Başlık satırı */}
              <View style={styles.orderTop}>
                <Text style={styles.orderId}>#{item.id.slice(-6).toUpperCase()}</Text>
                <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                  <Text style={[styles.statusText, { color: statusStyle.text }]}>
                    {STATUS_LABEL[item.status]}
                  </Text>
                </View>
              </View>

              {/* Ürünler */}
              {item.order_items.map((oi, idx) => (
                <Text key={idx} style={styles.orderItemText}>
                  {oi.quantity}× {oi.title_snapshot} — {priceTL(oi.unit_price_cents * oi.quantity)}
                </Text>
              ))}

              {/* Adres & not */}
              {item.delivery_address ? (
                <Text style={styles.orderMeta}>📍 {item.delivery_address}</Text>
              ) : null}
              {item.notes ? (
                <Text style={styles.orderMeta}>📝 {item.notes}</Text>
              ) : null}

              {/* Toplam & zaman */}
              <View style={styles.orderBottom}>
                <Text style={styles.orderDate}>
                  {new Date(item.created_at).toLocaleString('tr-TR', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
                <Text style={styles.orderTotal}>{priceTL(item.total_cents)}</Text>
              </View>

              {/* Aksiyon butonları */}
              {(nextStatus || item.status === 'pending' || item.status === 'accepted') && (
                <View style={styles.actionRow}>
                  {(item.status === 'pending' || item.status === 'accepted') && (
                    <Pressable
                      style={styles.cancelBtn}
                      onPress={() => cancelOrder(item)}
                    >
                      <Text style={styles.cancelBtnText}>İptal Et</Text>
                    </Pressable>
                  )}
                  {nextStatus && nextLabel && (
                    <Pressable
                      style={styles.advanceBtn}
                      onPress={() => updateStatus(item, nextStatus)}
                    >
                      <Text style={styles.advanceBtnText}>{nextLabel} →</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyTitle}>Sipariş yok</Text>
            <Text style={styles.emptyBody}>Bu filtrede gösterilecek sipariş bulunmuyor.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  infoText: { fontSize: 15, color: '#888', textAlign: 'center' },

  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EBE3',
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.secondary },

  filterBar: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E8E4DD',
  },
  filterTabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterTabText: { fontSize: 13, fontWeight: '600', color: '#888' },
  filterTabTextActive: { color: '#fff' },

  list: { padding: 16, paddingBottom: 32 },

  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F0EBE3',
    gap: 6,
  },
  orderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  orderId: { fontSize: 12, fontWeight: '700', color: '#AAAAAA' },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  orderItemText: { fontSize: 13, color: colors.secondary },
  orderMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  orderBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F5F0EA',
    paddingTop: 8,
  },
  orderDate: { fontSize: 11, color: '#AAAAAA' },
  orderTotal: { fontSize: 15, fontWeight: '800', color: colors.primary },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#FFEBEE',
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 13, fontWeight: '700', color: '#C62828' },
  advanceBtn: {
    flex: 2,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  advanceBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 52, lineHeight: 60 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.secondary, marginTop: 12 },
  emptyBody: { fontSize: 13, color: '#888', textAlign: 'center', marginTop: 6, lineHeight: 20 },
});
