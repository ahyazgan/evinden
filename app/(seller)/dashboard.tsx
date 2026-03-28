import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

type OrderStatus = 'pending' | 'accepted' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

type DemoOrder = {
  id: string;
  status: OrderStatus;
  total_cents: number;
  created_at: string;
  customer_name: string;
  items: string;
};

const DEMO_ORDERS: DemoOrder[] = [
  { id: 'o1', status: 'pending', total_cents: 17500, created_at: new Date(Date.now() - 5 * 60000).toISOString(), customer_name: 'Mehmet A.', items: '1× Kuru Fasulye + Pilav, 2× Mercimek Çorbası' },
  { id: 'o2', status: 'preparing', total_cents: 9500, created_at: new Date(Date.now() - 22 * 60000).toISOString(), customer_name: 'Ayşe K.', items: '1× İzmir Köfte' },
  { id: 'o3', status: 'ready', total_cents: 4500, created_at: new Date(Date.now() - 45 * 60000).toISOString(), customer_name: 'Fatma Y.', items: '1× Mercimek Çorbası' },
  { id: 'o4', status: 'delivered', total_cents: 21000, created_at: new Date(Date.now() - 2 * 3600000).toISOString(), customer_name: 'Ali B.', items: '2× İzmir Köfte, 1× Karışık Salata' },
  { id: 'o5', status: 'delivered', total_cents: 8000, created_at: new Date(Date.now() - 4 * 3600000).toISOString(), customer_name: 'Zeynep D.', items: '1× Kuru Fasulye + Pilav' },
];

const STATUS_CONFIG: Record<OrderStatus, { label: string; bg: string; text: string }> = {
  pending:   { label: 'Bekliyor',      bg: '#FFF8E1', text: '#F57F17' },
  accepted:  { label: 'Kabul Edildi',  bg: '#E3F2FD', text: '#1565C0' },
  preparing: { label: 'Hazırlanıyor',  bg: '#FFF3E0', text: '#E65100' },
  ready:     { label: 'Hazır',         bg: '#E8F5E9', text: '#2E7D32' },
  delivered: { label: 'Teslim Edildi', bg: '#E8F5E9', text: '#2E7D32' },
  cancelled: { label: 'İptal',         bg: '#F5F5F5', text: '#9E9E9E' },
};

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

function formatTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 60) return `${diffMin} dk önce`;
  return `${Math.floor(diffMin / 60)} saat önce`;
}

export default function SellerDashboardScreen() {
  const { profile } = useAuth();
  const router = useRouter();

  const todayOrders = DEMO_ORDERS.filter(o => o.status !== 'cancelled');
  const pendingCount = DEMO_ORDERS.filter(o => o.status === 'pending').length;
  const todayRevenue = todayOrders.filter(o => o.status === 'delivered').reduce((s, o) => s + o.total_cents, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.topRow}>
          <View>
            <Text style={styles.logo}>evinden</Text>
            <Text style={styles.greeting}>Merhaba, {profile?.name?.split(' ')[0] ?? 'Satıcı'} 👋</Text>
          </View>
          <Pressable
            style={styles.backBtn}
            onPress={() => router.push('/(customer)' as any)}
          >
            <Text style={styles.backBtnText}>← Müşteri</Text>
          </Pressable>
        </View>

        {/* Store card */}
        <View style={styles.storeCard}>
          <View style={styles.storeEmoji}>
            <Text style={{ fontSize: 28 }}>🍲</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.storeName}>Demo Mutfağım</Text>
            <Text style={styles.storeLoc}>📍 Kadıköy, İstanbul</Text>
          </View>
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>● Aktif</Text>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: '#FFF8E1' }]}>
            <Text style={styles.statNum}>{pendingCount}</Text>
            <Text style={styles.statLabel}>Bekleyen</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#E8F5E9' }]}>
            <Text style={styles.statNum}>{todayOrders.length}</Text>
            <Text style={styles.statLabel}>Bugün</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#E3F2FD' }]}>
            <Text style={[styles.statNum, { fontSize: 14 }]}>{priceTL(todayRevenue)}</Text>
            <Text style={styles.statLabel}>Gelir</Text>
          </View>
        </View>

        {/* Quick actions */}
        <View style={styles.quickRow}>
          <Pressable style={styles.quickBtn} onPress={() => router.push('/(seller)/menu' as any)}>
            <Text style={styles.quickEmoji}>🍽️</Text>
            <Text style={styles.quickLabel}>Menüyü Düzenle</Text>
          </Pressable>
          <Pressable style={styles.quickBtn} onPress={() => router.push('/(seller)/orders' as any)}>
            <Text style={styles.quickEmoji}>📦</Text>
            <Text style={styles.quickLabel}>Siparişler</Text>
            {pendingCount > 0 ? (
              <View style={styles.quickBadge}>
                <Text style={styles.quickBadgeText}>{pendingCount}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {/* Recent orders */}
        <Text style={styles.sectionTitle}>Son Siparişler</Text>

        {DEMO_ORDERS.map(order => {
          const sc = STATUS_CONFIG[order.status];
          return (
            <View key={order.id} style={styles.orderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.orderCustomer}>{order.customer_name}</Text>
                <Text style={styles.orderItems} numberOfLines={1}>{order.items}</Text>
                <Text style={styles.orderTime}>{formatTime(order.created_at)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 5 }}>
                <Text style={styles.orderTotal}>{priceTL(order.total_cents)}</Text>
                <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                  <Text style={[styles.statusText, { color: sc.text }]}>{sc.label}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  scroll: { padding: 20, paddingBottom: 40 },

  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  logo: { fontSize: 22, fontWeight: '900', color: colors.primary, letterSpacing: -0.5 },
  greeting: { fontSize: 13, color: '#A89A8A', marginTop: 2 },
  backBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    backgroundColor: '#fff',
  },
  backBtnText: { fontSize: 12, fontWeight: '600', color: '#6B5E50' },

  storeCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  storeEmoji: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#FFF3E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeName: { fontSize: 17, fontWeight: '800', color: '#1A1208', marginBottom: 3 },
  storeLoc: { fontSize: 12, color: '#A89A8A' },
  activeBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  activeBadgeText: { fontSize: 11, fontWeight: '700', color: '#2E7D32' },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  statNum: { fontSize: 20, fontWeight: '800', color: '#1A1208' },
  statLabel: { fontSize: 10, color: '#A89A8A', marginTop: 3, textAlign: 'center' },

  quickRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  quickBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 14,
    alignItems: 'center',
    gap: 6,
    position: 'relative',
  },
  quickEmoji: { fontSize: 26 },
  quickLabel: { fontSize: 12, fontWeight: '700', color: '#1A1208', textAlign: 'center' },
  quickBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: colors.primary,
    borderRadius: 8,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  quickBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },

  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A89A8A',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  orderRow: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  orderCustomer: { fontSize: 13, fontWeight: '700', color: '#1A1208', marginBottom: 2 },
  orderItems: { fontSize: 12, color: '#A89A8A', marginBottom: 3 },
  orderTime: { fontSize: 11, color: '#C4B8AA' },
  orderTotal: { fontSize: 14, fontWeight: '800', color: colors.primary },
  statusBadge: { borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: '700' },
});
