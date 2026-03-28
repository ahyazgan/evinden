import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

type MenuItem = { icon: string; label: string; sub?: string; onPress?: () => void };

export default function ProfileScreen() {
  const { profile } = useAuth();
  const router = useRouter();

  const initial = profile?.name?.charAt(0).toUpperCase() ?? 'D';

  const menuSections: { title: string; items: MenuItem[] }[] = [
    {
      title: 'Hesabım',
      items: [
        { icon: '📦', label: 'Siparişlerim', sub: '3 sipariş', onPress: () => router.push('/(customer)/orders' as any) },
        { icon: '❤️', label: 'Favorilerim', sub: '3 satıcı', onPress: () => router.push('/(customer)/favorites' as any) },
        { icon: '📍', label: 'Adreslerim', sub: 'Moda Cad. 42, Kadıköy' },
        { icon: '🔔', label: 'Bildirimler' },
      ],
    },
    {
      title: 'Destek',
      items: [
        { icon: '❓', label: 'Yardım & SSS' },
        { icon: '💬', label: 'Bize Ulaşın' },
        { icon: '⭐', label: 'Uygulamayı Değerlendir' },
      ],
    },
    {
      title: 'Uygulama',
      items: [
        { icon: '🔒', label: 'Gizlilik Politikası' },
        { icon: '📋', label: 'Kullanım Şartları' },
      ],
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profil</Text>
        </View>

        {/* User card */}
        <View style={styles.userCard}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <View style={styles.avatarBadge}>
              <Text style={styles.avatarBadgeText}>✓</Text>
            </View>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{profile?.name ?? 'Demo Kullanıcı'}</Text>
            <Text style={styles.userSub}>Müşteri · Kadıköy, İstanbul</Text>
          </View>
          <Pressable style={styles.editBtn}>
            <Text style={styles.editBtnText}>Düzenle</Text>
          </Pressable>
        </View>

        {/* Satıcı paneli butonu */}
        <Pressable
          style={styles.sellerBanner}
          onPress={() => router.push('/(seller)/dashboard' as any)}
        >
          <View style={styles.sellerBannerLeft}>
            <Text style={styles.sellerBannerEmoji}>🧑‍🍳</Text>
            <View>
              <Text style={styles.sellerBannerTitle}>Satıcı Paneline Geç</Text>
              <Text style={styles.sellerBannerSub}>Menü ve siparişlerini yönet</Text>
            </View>
          </View>
          <Text style={styles.sellerBannerArrow}>›</Text>
        </Pressable>

        {/* Menu sections */}
        {menuSections.map(section => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.sectionCard}>
              {section.items.map((item, idx) => (
                <Pressable
                  key={item.label}
                  style={[
                    styles.menuRow,
                    idx < section.items.length - 1 && styles.menuRowBorder,
                  ]}
                  onPress={item.onPress}
                >
                  <View style={styles.menuIcon}>
                    <Text style={styles.menuIconText}>{item.icon}</Text>
                  </View>
                  <View style={styles.menuLabel}>
                    <Text style={styles.menuLabelText}>{item.label}</Text>
                    {item.sub ? <Text style={styles.menuSub}>{item.sub}</Text> : null}
                  </View>
                  <Text style={styles.menuArrow}>›</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        {/* Version */}
        <Text style={styles.version}>evinden v1.0.0 · Demo Mod</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  scroll: { paddingBottom: 40 },

  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1A1208', fontFamily: 'serif' },

  userCard: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 24, fontWeight: '700', color: '#fff' },
  avatarBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#3DBE7A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  avatarBadgeText: { fontSize: 9, fontWeight: '900', color: '#fff' },
  userInfo: { flex: 1 },
  userName: { fontSize: 16, fontWeight: '800', color: '#1A1208', marginBottom: 2 },
  userSub: { fontSize: 12, color: '#A89A8A' },
  editBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  editBtnText: { fontSize: 12, fontWeight: '600', color: '#6B5E50' },

  sellerBanner: {
    marginHorizontal: 16,
    marginBottom: 24,
    backgroundColor: '#1A1208',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sellerBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sellerBannerEmoji: { fontSize: 30 },
  sellerBannerTitle: { fontSize: 15, fontWeight: '800', color: '#fff', marginBottom: 2 },
  sellerBannerSub: { fontSize: 12, color: '#A89A8A' },
  sellerBannerArrow: { fontSize: 22, color: colors.primary, fontWeight: '700' },

  section: { marginHorizontal: 16, marginBottom: 16 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A89A8A',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
  },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F5F0EA' },
  menuIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#FAF7F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconText: { fontSize: 17 },
  menuLabel: { flex: 1 },
  menuLabelText: { fontSize: 14, fontWeight: '600', color: '#1A1208' },
  menuSub: { fontSize: 11, color: '#A89A8A', marginTop: 1 },
  menuArrow: { fontSize: 18, color: '#C4B8AA', fontWeight: '600' },

  version: { textAlign: 'center', fontSize: 12, color: '#C4B8AA', marginTop: 8 },
});
