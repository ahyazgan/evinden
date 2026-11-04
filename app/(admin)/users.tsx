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
import { adminSetUserSuspended } from '@/lib/db';
import { fonts } from '@/lib/fonts';

type UserItem = {
  id: string;
  name: string | null;
  phone: string | null;
  role: string;
  is_suspended?: boolean;
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
        .select('id, name, phone, role, avatar_url, is_approved, is_suspended, created_at')
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
          const { error } = await supabase.from('users').update({ role: newRole }).eq('id', user.id);
          if (error) {
            Alert.alert('Rol değiştirilemedi', 'Lütfen tekrar dene.');
            return;
          }
          setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: newRole } : u));
        },
      },
    ]);
  };

  const toggleSuspended = (user: UserItem) => {
    const next = !user.is_suspended;
    Alert.alert(
      next ? 'Hesabı askıya al' : 'Askıyı kaldır',
      next
        ? `"${user.name ?? 'Kullanıcı'}" sipariş veremez, mesaj atamaz ve oturumu kapanır. Satıcıysa mağazası durur.`
        : `"${user.name ?? 'Kullanıcı'}" yeniden uygulamayı kullanabilir.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: next ? 'Askıya al' : 'Kaldır',
          style: next ? 'destructive' : 'default',
          onPress: async () => {
            try {
              await adminSetUserSuspended(user.id, next);
              setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_suspended: next } : u));
            } catch (e: any) {
              Alert.alert('İşlem yapılamadı', e?.code === '55000' ? e.message : 'Lütfen tekrar dene.');
            }
          },
        },
      ],
    );
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
          <Ionicons name="arrow-back" size={20} color="#151A16" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={st.headerTitle}>Kullanıcılar</Text>
          <Text style={st.headerSub}>{users.length} kullanıcı</Text>
        </View>
      </View>

      <View style={st.searchRow}>
        <Ionicons name="search" size={16} color="#6B766F" />
        <TextInput
          style={st.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="İsim veya telefon ara..."
          placeholderTextColor="#A3ACA5"
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
                  <Text style={st.cardName}>{user.name ?? 'İsimsiz'}{user.is_suspended ? ' · Askıda' : ''}</Text>
                  <Text style={st.cardPhone}>{user.phone ?? 'Telefon yok'}</Text>
                  <Text style={st.cardDate}>{formatDate(user.created_at)}</Text>
                </View>
                <View style={[st.roleBadge, { backgroundColor: roleBg }]}>
                  <Text style={[st.roleText, { color: roleColor }]}>{roleLabel}</Text>
                </View>
              </View>
              <View style={st.cardActions}>
                {user.role !== 'admin' && (
                  <Pressable style={[st.actionBtn, { backgroundColor: '#FFEBEE' }]} onPress={() => toggleSuspended(user)} accessibilityRole="button">
                    <Text style={[st.actionBtnText, { color: '#C62828' }]}>{user.is_suspended ? 'Askıyı kaldır' : 'Askıya al'}</Text>
                  </Pressable>
                )}
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
  safe: { flex: 1, backgroundColor: '#FAF8F2' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#E3E6DE' },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#EFF2EA', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontFamily: fonts.display, color: '#151A16' },
  headerSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', marginTop: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E3E6DE', paddingHorizontal: 14, paddingVertical: 10 },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: '#151A16' },
  filterRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#EFF2EA', borderWidth: 1, borderColor: '#E3E6DE' },
  filterPillActive: { backgroundColor: '#17402F', borderColor: '#151A16' },
  filterText: { fontSize: 12, fontFamily: fonts.semibold, color: '#56605A' },
  filterTextActive: { color: '#fff' },
  list: { padding: 16, gap: 8 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#E3E6DE' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#EFF2EA', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontFamily: fonts.extrabold, color: '#151A16' },
  cardInfo: { flex: 1, gap: 1 },
  cardName: { fontSize: 14, fontFamily: fonts.bold, color: '#151A16' },
  cardPhone: { fontFamily: fonts.regular, fontSize: 12, color: '#56605A' },
  cardDate: { fontFamily: fonts.regular, fontSize: 11, color: '#A3ACA5' },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  roleText: { fontSize: 11, fontFamily: fonts.bold },
  cardActions: { flexDirection: 'row', gap: 6, marginTop: 10 },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  actionBtnText: { fontSize: 12, fontFamily: fonts.semibold },
});
