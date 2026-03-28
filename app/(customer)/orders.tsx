import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import type { Order, OrderStatus } from '@/types';

type OrderWithDetails = Order & {
  sellers: { display_name: string } | null;
  order_items: { title_snapshot: string; quantity: number; line_total_cents: number }[];
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

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function CustomerOrdersScreen() {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from('orders')
      .select('*, sellers(display_name), order_items(title_snapshot, quantity, line_total_cents)')
      .eq('customer_id', profile.id)
      .order('created_at', { ascending: false });
    setOrders((data as OrderWithDetails[]) ?? []);
  }, [profile]);

  useEffect(() => {
    fetchOrders().finally(() => setLoading(false));
  }, [fetchOrders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  }, [fetchOrders]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Siparişlerim</Text>
      </View>

      <FlatList
        data={orders}
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
          const expanded = expandedId === item.id;

          return (
            <Pressable
              style={styles.orderCard}
              onPress={() => setExpandedId(expanded ? null : item.id)}
            >
              <View style={styles.orderTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderSeller}>
                    {item.sellers?.display_name ?? 'Bilinmeyen Satıcı'}
                  </Text>
                  <Text style={styles.orderDate}>{formatDate(item.created_at)}</Text>
                </View>
                <View>
                  <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                    <Text style={[styles.statusText, { color: statusStyle.text }]}>
                      {STATUS_LABEL[item.status]}
                    </Text>
                  </View>
                  <Text style={styles.orderTotal}>{priceTL(item.total_cents)}</Text>
                </View>
              </View>

              {expanded && (
                <View style={styles.itemsWrap}>
                  <View style={styles.divider} />
                  {item.order_items.map((oi, idx) => (
                    <View key={idx} style={styles.orderItemRow}>
                      <Text style={styles.orderItemText}>
                        {oi.quantity}× {oi.title_snapshot}
                      </Text>
                      <Text style={styles.orderItemPrice}>{priceTL(oi.line_total_cents)}</Text>
                    </View>
                  ))}
                  {item.delivery_address ? (
                    <Text style={styles.orderAddress}>📍 {item.delivery_address}</Text>
                  ) : null}
                </View>
              )}

              <Text style={styles.expandHint}>{expanded ? '▲ Kapat' : '▼ Detaylar'}</Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📦</Text>
            <Text style={styles.emptyTitle}>Henüz sipariş yok</Text>
            <Text style={styles.emptyBody}>
              İlk siparişinizi vermek için satıcılara göz atın.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EBE3',
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.secondary },

  list: { padding: 20, paddingBottom: 32 },

  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F0EBE3',
  },
  orderTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  orderSeller: { fontSize: 15, fontWeight: '700', color: colors.secondary, marginBottom: 3 },
  orderDate: { fontSize: 12, color: '#999' },
  statusBadge: {
    alignSelf: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 4,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  orderTotal: { fontSize: 14, fontWeight: '800', color: colors.primary, textAlign: 'right' },

  divider: { height: 1, backgroundColor: '#F0EBE3', marginVertical: 10 },
  itemsWrap: { marginTop: 2 },
  orderItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  orderItemText: { fontSize: 13, color: '#555', flex: 1 },
  orderItemPrice: { fontSize: 13, fontWeight: '600', color: colors.secondary },
  orderAddress: { fontSize: 12, color: '#888', marginTop: 8 },

  expandHint: { fontSize: 11, color: '#AAAAAA', textAlign: 'center', marginTop: 8 },

  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 56, lineHeight: 64 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.secondary, marginTop: 12 },
  emptyBody: { fontSize: 14, color: '#888', textAlign: 'center', marginTop: 8, lineHeight: 20 },
});
