import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@/lib/auth-context';
import { pickAndUploadImage } from '@/lib/storage';
import { fonts } from '@/lib/fonts';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme-context';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TopBar } from '@/components/shared/TopBar';

export default function ProfileEditScreen() {
  const router = useRouter();
  const { colors: t } = useTheme();
  const { profile, updateProfile } = useAuth();

  const [name, setName] = useState(profile?.name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? null);
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? '')).catch(() => {});
  }, []);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const initial = name.charAt(0).toLocaleUpperCase('tr-TR') || '?';

  const handleAvatarPick = async () => {
    try {
      setUploadingAvatar(true);
      const url = await pickAndUploadImage('avatars', `users/${profile?.id ?? 'new'}/avatar`, { aspect: [1, 1] });
      if (url) setAvatarUrl(url);
    } catch (e: any) {
      Alert.alert('Hata', e.message ?? 'Fotoğraf yüklenemedi.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Hata', 'İsim boş bırakılamaz.');
      return;
    }
    if (!phone.trim() || phone.trim().length < 10) {
      Alert.alert('Hata', 'Geçerli bir telefon numarası gir.');
      return;
    }
    setSaving(true);
    await updateProfile({ name: name.trim(), phone: phone.trim(), avatar_url: avatarUrl });
    setSaving(false);
    Alert.alert('Başarılı', 'Profilin güncellendi.', [
      { text: 'Tamam', onPress: () => router.back() },
    ]);
  };

  return (
    <View style={[st.safe, { backgroundColor: t.background }]}>
      <TopBar back title="Profili düzenle" />

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        <View style={st.avatarSection}>
          <Pressable
            style={st.avatarPress}
            onPress={handleAvatarPick}
            disabled={uploadingAvatar}
            accessibilityRole="button"
            accessibilityLabel="Fotoğrafı değiştir"
          >
            <View style={[st.avatar, { backgroundColor: t.accent }]}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={st.avatarImage} />
              ) : (
                <Text style={[st.avatarText, { color: t.onAccent }]}>{initial}</Text>
              )}
              {uploadingAvatar ? (
                <View style={[st.avatarOverlay, { backgroundColor: t.brand }]}>
                  <ActivityIndicator color={t.onBrand} />
                </View>
              ) : null}
            </View>
          </Pressable>
          <Pressable
            style={[st.avatarChangeBtn, { backgroundColor: t.surface }]}
            onPress={handleAvatarPick}
            disabled={uploadingAvatar}
            accessibilityRole="button"
          >
            <Ionicons name="camera-outline" size={18} color={t.text} />
            <Text style={[st.avatarChangeText, { color: t.text }]}>{uploadingAvatar ? 'Yükleniyor...' : 'Fotoğrafı değiştir'}</Text>
          </Pressable>
        </View>

        <View style={[st.card, st.form, { backgroundColor: t.surface }]}>
          <Input
            label="Ad soyad"
            accessibilityLabel="Ad soyad"
            value={name}
            onChangeText={setName}
            placeholder="Adın ve soyadın"
            autoCapitalize="words"
          />
          <Input
            label="Telefon numarası"
            accessibilityLabel="Telefon numarası"
            value={phone}
            onChangeText={setPhone}
            placeholder="05XX XXX XX XX"
            keyboardType="phone-pad"
          />
          <Input
            label="E-posta"
            accessibilityLabel="E-posta"
            value={email}
            placeholder="Henüz eklenmedi"
            editable={false}
          />
        </View>

        <View style={[st.card, st.info, { backgroundColor: t.surface }]}>
          <Ionicons name="shield-checkmark-outline" size={20} color={t.success} />
          <Text style={[st.infoText, { color: t.textSecondary }]}>
            Bilgilerin güvenle saklanır ve üçüncü şahıslarla paylaşılmaz.
          </Text>
        </View>

        <Button label="Değişiklikleri kaydet" size="lg" fullWidth loading={saving} onPress={handleSave} />
      </ScrollView>
    </View>
  );
}

const AVATAR = 80;

const st = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40, gap: 12 },

  avatarSection: { alignItems: 'center', gap: 10, marginBottom: 4 },
  avatarPress: { width: AVATAR, height: AVATAR },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
  avatarText: { fontSize: 32, fontFamily: fonts.extrabold },
  avatarOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  avatarChangeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 12 },
  avatarChangeText: { fontSize: 13, fontFamily: fonts.bold },

  card: { borderRadius: 16, padding: 14 },
  form: { gap: 14 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  infoText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
