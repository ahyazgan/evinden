import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { fonts } from '@/lib/fonts';
import { useResponsive } from '@/lib/responsive';
import { supabase } from '@/lib/supabase';
import { useDeleteAccount } from '@/lib/useDeleteAccount';
import { fetchUnreadCount } from '@/lib/messages';
import { Button } from '@/components/ui/Button';
import { useTabBarSpace } from '@/components/shared/ChainTabBar';
import { LogoMark } from '@/components/shared/Logo';
import { TopBar } from '@/components/shared/TopBar';

export default function ProfileScreen() {
  const { session, profile, signOut, refreshProfile, setMarketingConsent } = useAuth();
  const { colors: t } = useTheme();
  const router = useRouter();
  const { isDesktop } = useResponsive();
  const tabBarSpace = useTabBarSpace();
  const confirmDeleteAccount = useDeleteAccount();
  const isLoggedIn = !!session;
  const isSeller = profile?.role === 'seller';
  const sellerApp = profile?.seller_application ?? 'none';
  const initial = profile?.name?.charAt(0).toLocaleUpperCase('tr-TR') ?? '?';
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [email, setEmail] = useState('');
  // Anahtar hemen değişir; kayıt bitince profildeki değer geçerli olur, hata olursa eski hâline döner.
  const [pendingConsent, setPendingConsent] = useState<boolean | null>(null);
  const marketingOn = pendingConsent ?? !!profile?.marketing_consent;

  const toggleMarketing = async (next: boolean) => {
    if (pendingConsent !== null) return;
    setPendingConsent(next);
    const { error } = await setMarketingConsent(next);
    setPendingConsent(null);
    if (error) Alert.alert('Kaydedilemedi', 'İnternet bağlantını kontrol edip tekrar dene.');
  };

  useFocusEffect(useCallback(() => {
    if (isLoggedIn) fetchUnreadCount('customer').then(setUnreadMessages);
  }, [isLoggedIn]));

  useEffect(() => {
    if (!isLoggedIn) {
      setEmail('');
      return;
    }
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? '')).catch(() => {});
  }, [isLoggedIn]);

  const go = (path: string) => () => router.push(path as any);

  const identity = (
    <View style={s.identity}>
      <View style={[s.avatar, { backgroundColor: t.accent }]}>
        <Text style={[s.avatarText, { color: t.onAccent }]}>{initial}</Text>
      </View>
      <View style={s.identityText}>
        <Text style={[s.name, { color: isDesktop ? t.heading : t.onBrand }]} numberOfLines={1} accessibilityRole="header">
          {profile?.name ?? 'Kullanıcı'}
        </Text>
        <Text style={[s.email, { color: isDesktop ? t.textSecondary : t.onBrandSoft }]} numberOfLines={1}>
          {email || (isSeller ? 'Satıcı' : 'Müşteri')}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={[s.safe, { backgroundColor: t.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: isDesktop ? 32 : tabBarSpace }} showsVerticalScrollIndicator={false}>
        {isLoggedIn ? (
          <TopBar
            leading={identity}
            right={(
              <Pressable
                style={[s.editBtn, { backgroundColor: t.panel }]}
                onPress={go('/(customer)/profile-edit')}
                accessibilityRole="button"
                accessibilityLabel="Profili düzenle"
              >
                <Text style={[s.editText, { color: t.onBrand }]}>Düzenle</Text>
              </Pressable>
            )}
          />
        ) : (
          <TopBar title="Profil" />
        )}

        {!isLoggedIn ? (
          <View style={[s.guest, { backgroundColor: t.surface }]}>
            <View style={[s.guestIcon, { backgroundColor: t.chip }]}>
              <Ionicons name="person-outline" size={28} color={t.text} />
            </View>
            <Text style={[s.guestTitle, { color: t.heading }]}>Hoş geldin!</Text>
            <Text style={[s.guestSub, { color: t.textSecondary }]}>Giriş yap ya da hesap oluştur.</Text>
            <View style={s.guestActions}>
              <Button label="Giriş yap" size="lg" fullWidth onPress={go('/(auth)/login')} />
              <Button label="Hesap oluştur" variant="outline" size="lg" fullWidth onPress={go('/(auth)/register')} />
            </View>
          </View>
        ) : null}

        <View style={[s.card, { backgroundColor: t.surface }]}>
          {isLoggedIn ? (
            <>
              <MenuItem icon="receipt-outline" label="Siparişlerim" onPress={go('/(customer)/orders')} />
              <MenuItem icon="heart-outline" label="Favorilerim" onPress={go('/(customer)/favorites')} />
              <MenuItem icon="location-outline" label="Adreslerim" onPress={go('/(customer)/addresses')} />
              <MenuItem
                icon="chatbubble-outline"
                label="Mesajlarım"
                sub={unreadMessages > 0 ? `${unreadMessages} okunmamış` : undefined}
                onPress={go('/(customer)/messages')}
              />
              <MenuItem icon="notifications-outline" label="Bildirimler" onPress={go('/(customer)/notifications')} />
              <View style={[s.row, { borderBottomWidth: 1, borderBottomColor: t.divider }]}>
                <Ionicons name="megaphone-outline" size={20} color={t.text} />
                <View style={s.rowBody}>
                  <Text style={[s.rowLabel, { color: t.text }]}>Kampanya bildirimleri</Text>
                  <Text style={[s.rowSub, { color: t.textSecondary }]}>Sipariş bildirimlerin bundan etkilenmez.</Text>
                </View>
                <Switch
                  value={marketingOn}
                  onValueChange={toggleMarketing}
                  trackColor={{ true: t.primary, false: t.divider }}
                  thumbColor={t.onBrand}
                  {...({ activeThumbColor: t.onBrand } as object)}
                  accessibilityLabel="Kampanya bildirimleri"
                />
              </View>
              <MenuItem icon="pricetag-outline" label="Kampanyalar" onPress={go('/(customer)/campaign')} />
              <MenuItem icon="gift-outline" label="Sadakat programı" onPress={go('/(customer)/loyalty')} />
            </>
          ) : null}
          <MenuItem icon="help-circle-outline" label="Yardım ve destek" onPress={() => router.push('/(customer)/help' as any)} />
          <MenuItem icon="mail-outline" label="Bize ulaş" onPress={() => Linking.openURL('mailto:destek@afiyetli.app')} />
          <MenuItem icon="star-outline" label="Uygulamayı değerlendir" onPress={() => Alert.alert('Teşekkürler!', 'Uygulama mağazaya yüklendiğinde değerlendirme yapabileceksin.')} last />
        </View>

        {isLoggedIn ? (
          isSeller ? (
            <Pressable style={[s.limeRow, { backgroundColor: t.accent }]} onPress={go('/restoran/dashboard')} accessibilityRole="button">
              <Ionicons name="storefront-outline" size={20} color={t.onAccent} />
              <Text style={[s.limeText, { color: t.onAccent }]}>Satıcı panelim</Text>
              <Ionicons name="chevron-forward" size={18} color={t.onAccent} />
            </Pressable>
          ) : sellerApp === 'pending' ? (
            <View style={[s.pending, { backgroundColor: t.surface }]}>
              <Ionicons name="hourglass-outline" size={20} color={t.text} />
              <Text style={[s.pendingText, { color: t.text }]}>Başvurun inceleniyor</Text>
              <Button label="Durumu yenile" size="sm" onPress={() => refreshProfile()} />
            </View>
          ) : (
            <Pressable
              style={[s.limeRow, { backgroundColor: t.accent }]}
              onPress={go('/(customer)/seller-apply')}
              accessibilityRole="button"
              accessibilityHint="Afiyetli'de satış yapmaya başla"
            >
              <Ionicons name="storefront-outline" size={20} color={t.onAccent} />
              <Text style={[s.limeText, { color: t.onAccent }]}>Restoranını ekle</Text>
              <Ionicons name="chevron-forward" size={18} color={t.onAccent} />
            </Pressable>
          )
        ) : null}

        <View style={[s.card, { backgroundColor: t.surface }]}>
          <MenuItem icon="lock-closed-outline" label="Gizlilik politikası" onPress={go('/(customer)/privacy')} />
          <MenuItem icon="document-text-outline" label="Kullanım koşulları" onPress={go('/(customer)/terms')} last={!isLoggedIn} />
          {isLoggedIn ? (
            <>
              <Pressable
                style={[s.dangerRow, { borderBottomColor: t.divider, borderBottomWidth: 1 }]}
                onPress={() => {
                  signOut();
                  router.replace('/(auth)/login' as any);
                }}
                accessibilityRole="button"
              >
                <Text style={[s.dangerText, { color: t.danger }]}>Çıkış yap</Text>
              </Pressable>
              <Pressable style={s.dangerRow} onPress={confirmDeleteAccount} accessibilityRole="button">
                <Text style={[s.dangerText, { color: t.danger }]}>Hesabımı sil</Text>
              </Pressable>
            </>
          ) : null}
        </View>

        <View style={s.footer}>
          <LogoMark size={28} />
          <Text style={[s.version, { color: t.textMuted }]}>Afiyetli v1.0.0</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function MenuItem({ icon, label, sub, onPress, last }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  onPress: () => void;
  last?: boolean;
}) {
  const { colors: t } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        !last && { borderBottomWidth: 1, borderBottomColor: t.divider },
        pressed && s.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
    >
      <Ionicons name={icon} size={20} color={t.text} />
      <View style={s.rowBody}>
        <Text style={[s.rowLabel, { color: t.text }]}>{label}</Text>
        {sub ? <Text style={[s.rowSub, { color: t.textSecondary }]}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.textSecondary} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },

  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 24, fontFamily: fonts.extrabold },
  identityText: { flex: 1, minWidth: 0 },
  name: { fontSize: 22, lineHeight: 26, fontFamily: fonts.display, letterSpacing: -0.6 },
  email: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, marginTop: 2 },
  editBtn: { height: 44, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  editText: { fontSize: 13, fontFamily: fonts.bold },

  guest: { marginHorizontal: 16, marginTop: 14, borderRadius: 16, padding: 14, alignItems: 'center' },
  guestIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginTop: 10, marginBottom: 12 },
  guestTitle: { fontSize: 20, lineHeight: 26, fontFamily: fonts.display, letterSpacing: -0.4 },
  guestSub: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, marginTop: 2, marginBottom: 16, textAlign: 'center' },
  guestActions: { alignSelf: 'stretch', gap: 10 },

  card: { marginHorizontal: 16, marginTop: 14, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  pressed: { opacity: 0.6 },
  rowBody: { flex: 1, minWidth: 0, paddingVertical: 6 },
  rowLabel: { fontSize: 14, fontFamily: fonts.semibold },
  rowSub: { fontSize: 12, fontFamily: fonts.regular, marginTop: 1 },

  limeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 16 },
  limeText: { flex: 1, fontSize: 14, fontFamily: fonts.extrabold },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  pendingText: { flex: 1, fontSize: 14, fontFamily: fonts.bold },

  dangerRow: { minHeight: 52, justifyContent: 'center' },
  dangerText: { fontSize: 14, fontFamily: fonts.bold },

  footer: { alignItems: 'center', gap: 4, marginTop: 18 },
  version: { textAlign: 'center', fontFamily: fonts.regular, fontSize: 12 },
});
