import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

type UserItem = {
  id: string;
  name: string | null;
  phone: string | null;
  role: string;
  avatar_url: string | null;
  is_approved: boolean;
  created_at: string;
};

export default function AdminUsersScreen() {
  const router = useRouter();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'buyer' | 'seller' | 'admin'>('all');

  const loadUsers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, phone, role, avatar_url, is_approved, created_at')
        .order('created_at', { ascending: false });
      if (!error && data) setUsers(data);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadUsers();
    setRefreshing(false);
  }, [loadUsers]);

  const changeRole = (user: UserItem, newRole: string) => {
    Alert.alert('Rol Değiştir', `"${user.name ?? 'Kullanıcı'}" rolü "${newRole}" olarak değiştirilecek.`, [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Onayla',
        onPress: async () => {
          setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: newRole } : u));
          await supabase.from('users').update({ role: newRole }).eq('id', user.id);
        },
      },
    ]);
  };

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });

  const filtered = users.filter(u => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (u.name ?? '').toLowerCase().includes(q) || (u.phone ?? '').includes(q);
    }
    return true;
  });

  const roleCounts = {
    buyer: users.filter(u => u.role === 'buyer').length,
    seller: users.filter(u => u.role === 'seller').length,
    admin: users.filter(u => u.role === 'admin').length,
  };

  if (loading) {
    return (
      <SafeAreaView style={st.safe} edges={['top']}>
        <View style={st.loading}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color="#1A1208" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={st.headerTitle}>Kullanıcılar</Text>
          <Text style={st.headerSub}>{users.length} kullanıcı</Text>
        </View>
      </View>

      <View style={st.searchRow}>
        <Ionicons name="search" size={16} color="#A89A8A" />
        <TextInput
          style={st.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="İsim veya telefon ara..."
          placeholderTextColor="#C4B8AA"
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filterRow} style={{ flexGrow: 0 }}>
        {([
          { key: 'all', label: `Tümü (${users.length})` },
          { key: 'buyer', label: `Müşteri (${roleCounts.buyer})` },
          { key: 'seller', label: `Satıcı (${roleCounts.seller})` },
          { key: 'admin', label: `Admin (${roleCounts.admin})` },
        ] as const).map(tab => (
          <Pressable key={tab.key} style={[st.filterPill, roleFilter === tab.key && st.filterPillActive]} onPress={() => setRoleFilter(tab.key)}>
            <Text style={[st.filterText, roleFilter === tab.key && st.filterTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={st.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {filtered.map(user => {
          const roleColor = user.role === 'admin' ? '#AD1457' : user.role === 'seller' ? '#2E7D32' : '#1565C0';
          const roleBg = user.role === 'admin' ? '#FCE4EC' : user.role === 'seller' ? '#E8F5E9' : '#E3F2FD';
          const roleLabel = user.role === 'admin' ? 'Admin' : user.role === 'seller' ? 'Satıcı' : 'Müşteri';
          return (
            <View key={user.id} style={st.card}>
              <View style={st.cardTop}>
                <View style={st.avatar}>
                  <Text style={st.avatarText}>{(user.name ?? '?').charAt(0).toUpperCase()}</Text>
                </View>
                <View style={st.cardInfo}>
                  <Text style={st.cardName}>{user.name ?? 'İsimsiz'}</Text>
                  <Text style={st.cardPhone}>{user.phone ?? 'Telefon yok'}</Text>
                  <Text style={st.cardDate}>{formatDate(user.created_at)}</Text>
                </View>
                <View style={[st.roleBadge, { backgroundColor: roleBg }]}>
                  <Text style={[st.roleText, { color: roleColor }]}>{roleLabel}</Text>
                </View>
              </View>
              <View style={st.cardActions}>
                {user.role !== 'admin' && (
                  <Pressable style={[st.actionBtn, { backgroundColor: '#FCE4EC' }]} onPress={() => changeRole(user, 'admin')}>
                    <Text style={[st.actionBtnText, { color: '#AD1457' }]}>Admin Yap</Text>
                  </Pressable>
                )}
                {user.role !== 'seller' && (
                  <Pressable style={[st.actionBtn, { backgroundColor: '#E8F5E9' }]} onPress={() => changeRole(user, 'seller')}>
                    <Text style={[st.actionBtnText, { color: '#2E7D32' }]}>Satıcı Yap</Text>
                  </Pressable>
                )}
                {user.role !== 'buyer' && (
                  <Pressable style={[st.actionBtn, { backgroundColor: '#E3F2FD' }]} onPress={() => changeRole(user, 'buyer')}>
                    <Text style={[st.actionBtnText, { color: '#1565C0' }]}>Müşteri Yap</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#EDE8E2' },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#F5F0EA', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#1A1208' },
  headerSub: { fontSize: 12, color: '#A89A8A', marginTop: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#EDE8E2', paddingHorizontal: 14, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 14, color: '#1A1208' },
  filterRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#F5F0EA', borderWidth: 1, borderColor: '#EDE8E2' },
  filterPillActive: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  filterText: { fontSize: 12, fontWeight: '600', color: '#6B5E50' },
  filterTextActive: { color: '#fff' },
  list: { padding: 16, gap: 8 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#EDE8E2' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#F5F0EA', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '800', color: '#1A1208' },
  cardInfo: { flex: 1, gap: 1 },
  cardName: { fontSize: 14, fontWeight: '700', color: '#1A1208' },
  cardPhone: { fontSize: 12, color: '#6B5E50' },
  cardDate: { fontSize: 11, color: '#C4B8AA' },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  roleText: { fontSize: 11, fontWeight: '700' },
  cardActions: { flexDirection: 'row', gap: 6, marginTop: 10 },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  actionBtnText: { fontSize: 12, fontWeight: '600' },
});
