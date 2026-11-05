import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SearchField, TopBar } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { adminSetUserSuspended } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

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
  const { colors: t } = useTheme();
  const st = useMemo(() => createStyles(t), [t]);
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

  return (
    <View style={st.safe}>
      <TopBar title="Kullanıcılar" subtitle={loading ? undefined : `${users.length} kullanıcı`} back>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder="İsim veya telefon ara..."
          accessibilityLabel="İsim veya telefon ara"
        />
      </TopBar>

      {loading ? (
        <View style={st.loading}><ActivityIndicator size="large" color={t.primary} /></View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filterRow} style={{ flexGrow: 0 }}>
            {([
              { key: 'all', label: `Tümü (${users.length})` },
              { key: 'buyer', label: `Müşteri (${roleCounts.buyer})` },
              { key: 'seller', label: `Satıcı (${roleCounts.seller})` },
              { key: 'admin', label: `Admin (${roleCounts.admin})` },
            ] as const).map(tab => (
              <Pressable
                key={tab.key}
                style={[st.filterPill, roleFilter === tab.key && st.filterPillActive]}
                onPress={() => setRoleFilter(tab.key)}
                hitSlop={{ top: 2, bottom: 2 }}
                accessibilityRole="button"
                accessibilityState={{ selected: roleFilter === tab.key }}
              >
                <Text style={[st.filterText, roleFilter === tab.key && st.filterTextActive]}>{tab.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView
            contentContainerStyle={st.list}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          >
            {filtered.map(user => {
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
                    <View style={st.badges}>
                      <View style={st.roleBadge}>
                        <Text style={st.roleText}>{roleLabel}</Text>
                      </View>
                      {user.is_suspended ? (
                        <View style={st.roleBadge}>
                          <Text style={[st.roleText, { color: t.danger }]}>Askıda</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <View style={st.cardActions}>
                    {user.role !== 'admin' && (
                      <Button
                        label={user.is_suspended ? 'Askıyı kaldır' : 'Askıya al'}
                        variant={user.is_suspended ? 'outline' : 'danger'}
                        onPress={() => toggleSuspended(user)}
                      />
                    )}
                    {user.role !== 'admin' && (
                      <Button label="Admin yap" variant="outline" onPress={() => changeRole(user, 'admin')} />
                    )}
                    {user.role !== 'seller' && (
                      <Button label="Satıcı yap" variant="outline" onPress={() => changeRole(user, 'seller')} />
                    )}
                    {user.role !== 'buyer' && (
                      <Button label="Müşteri yap" variant="outline" onPress={() => changeRole(user, 'buyer')} />
                    )}
                  </View>
                </View>
              );
            })}
            <View style={{ height: 32 }} />
          </ScrollView>
        </>
      )}
    </View>
  );
}

const createStyles = (t: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  filterRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  filterPill: { height: 40, paddingHorizontal: 14, borderRadius: 10, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' },
  filterPillActive: { backgroundColor: t.primary },
  filterText: { fontSize: 13, fontFamily: fonts.semibold, color: t.text },
  filterTextActive: { color: t.onBrand },
  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  card: { backgroundColor: t.surface, borderRadius: 16, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 12, backgroundColor: t.background, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontFamily: fonts.display, color: t.text },
  cardInfo: { flex: 1, gap: 1 },
  cardName: { fontSize: 14, fontFamily: fonts.bold, color: t.text },
  cardPhone: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary },
  cardDate: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary },
  badges: { alignItems: 'flex-end', gap: 4 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: t.background },
  roleText: { fontSize: 11, fontFamily: fonts.bold, color: t.text },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
});
