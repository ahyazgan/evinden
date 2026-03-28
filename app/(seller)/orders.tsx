import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { colors } from '@/constants/theme';
import type { Order, OrderStatus } from '@/types';

// Durumun Türkçe adı ve bir sonraki adım
const STATUS_META: Record<
  OrderStatus,
  { label: string; color: string; next: OrderStatus | null; nextLabel: string | null }
> = {
  pending:          { label: 'Bekliyor',       color: colors.amber,   next: 'accepted',         nextLabel: 'Kabul Et' },
  accepted:         { label: 'Kabul Edildi',   color: colors.primary, next: 'preparing',        nextLabel: 'Hazırlanıyor' },
  preparing:        { label: 'Hazırlanıyor',   color: colors.primary, next: 'ready',            nextLabel: 'Hazır' },
  ready:            { label: 'Hazır',          color: colors.success, next: 'out_for_delivery', nextLabel: 'Yola Çıktı' },
  out_for_delivery: { label: 'Yolda',          color: colors.success, next: 'delivered',        nextLabel: 'Teslim Edildi' },
  delivered:        { label: 'Teslim Edildi',  color: '#aaa',         next: null,               nextLabel: null },
  cancelled:        { label: 'İptal',          color: '#e55',         next: null,               nextLabel: null },
};

type OrderWithItems = Order & { item_count: number };

export default function SellerOrdersScreen() {
  const { profile } = useAuth();
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    initSeller();
    return () => {
      channelRef.current?.unsubscribe();
    };
  }, []);

  async function initSeller() {
    if (!profile) return;
    const { data } = await supabase
      .from('sellers')
      .select('id')
      .eq('user_id', profile.id)
      .maybeSingle();
    if (data) {
      setSellerId(data.id);
      await loadOrders(data.id);
      subscribeToOrders(data.id);
    }
    setLoading(false);
  }

  async function loadOrders(sid: string) {
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(id)')
      .eq('seller_id', sid)
      .not('status', 'in', '("delivered","cancelled")')
      .order('created_at', { ascending: false });

    const mapped: OrderWithItems[] = (data ?? []).map((o: any) => ({
      ...o,
      item_count: o.order_items?.length ?? 0,
    }));
    setOrders(mapped);
  }

  function subscribeToOrders(sid: string) {
    channelRef.current = supabase
      .channel(`seller-orders-${sid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `seller_id=eq.${sid}` },
        () => loadOrders(sid),
      )
      .subscribe();
  }

  async function advanceStatus(order: OrderWithItems) {
    const meta = STATUS_META[order.status];
    if (!meta.next) return;
    setUpdating(order.id);
    await supabase
      .from('orders')
      .update({ status: meta.next, updated_at: new Date().toISOString() })
      .eq('id', order.id);
    if (sellerId) await loadOrders(sellerId);
    setUpdating(null);
  }

  async function cancelOrder(order: OrderWithItems) {
    setUpdating(order.id);
    await supabase
      .from('orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', order.id);
    if (sellerId) await loadOrders(sellerId);
    setUpdating(null);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Aktif Siparişler</Text>
        <Text style={styles.sub}>{orders.length} sipariş</Text>
      </View>

      {orders.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Şu an bekleyen sipariş yok.</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ paddingBottom: 32 }}
          renderItem={({ item: order }) => {
            const meta = STATUS_META[order.status];
            const isUpdating = updating === order.id;

            return (
              <View style={styles.card}>
                {/* Üst satır */}
                <View style={styles.cardTop}>
                  <Text style={styles.orderId}>
                    #{order.id.slice(0, 8).toUpperCase()}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: meta.color + '20' }]}>
                    <Text style={[styles.badgeText, { color: meta.color }]}>
                      {meta.label}
                    </Text>
                  </View>
                </View>

                {/* Özet */}
                <View style={styles.cardMeta}>
                  <Text style={styles.metaText}>{order.item_count} kalem</Text>
                  <Text style={styles.metaText}>
                    {(order.total_cents / 100).toLocaleString('tr-TR', {
                      style: 'currency',
                      currency: 'TRY',
                    })}
                  </Text>
                  <Text style={styles.metaText}>
                    {new Date(order.created_at).toLocaleTimeString('tr-TR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>

                {order.notes ? (
                  <Text style={styles.notes}>Not: {order.notes}</Text>
                ) : null}

                {/* Aksiyonlar */}
                {isUpdating ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.primary}
                    style={{ marginTop: 12 }}
                  />
                ) : (
                  <View style={styles.actions}>
                    {meta.next ? (
                      <Pressable
                        style={styles.advanceBtn}
                        onPress={() => advanceStatus(order)}
                      >
                        <Text style={styles.advanceBtnText}>{meta.nextLabel}</Text>
                      </Pressable>
                    ) : null}
                    {order.status === 'pending' ? (
                      <Pressable
                        style={styles.cancelBtn}
                        onPress={() => cancelOrder(order)}
                      >
                        <Text style={styles.cancelBtnText}>Reddet</Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '700', color: colors.secondary },
  sub: { fontSize: 13, color: '#999', marginTop: 2 },
  emptyText: { fontSize: 15, color: '#aaa' },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  orderId: { fontSize: 13, fontWeight: '700', color: '#888', letterSpacing: 0.5 },
  badge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  cardMeta: { flexDirection: 'row', gap: 16, marginBottom: 4 },
  metaText: { fontSize: 13, color: '#666' },
  notes: {
    fontSize: 13,
    color: '#888',
    fontStyle: 'italic',
    marginTop: 6,
    backgroundColor: '#fafafa',
    padding: 8,
    borderRadius: 6,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  advanceBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  advanceBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  cancelBtn: {
    borderWidth: 1,
    borderColor: '#e55',
    borderRadius: 8,
    padding: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  cancelBtnText: { color: '#e55', fontWeight: '700', fontSize: 14 },
});
