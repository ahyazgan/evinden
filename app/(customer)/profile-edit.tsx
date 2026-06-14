import { useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
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
import { useAuth } from '@/lib/auth-context';
import { pickAndUploadImage } from '@/lib/storage';

export default function ProfileEditScreen() {
  const router = useRouter();
  const { profile, updateProfile } = useAuth();

  const [name, setName] = useState(profile?.name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? null);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const initial = name.charAt(0).toUpperCase() || '?';

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
      Alert.alert('Hata', 'Geçerli bir telefon numarası girin.');
      return;
    }
    setSaving(true);
    await updateProfile({ name: name.trim(), phone: phone.trim(), avatar_url: avatarUrl });
    setSaving(false);
    Alert.alert('Başarılı', 'Profiliniz güncellendi.', [
      { text: 'Tamam', onPress: () => router.back() },
    ]);
  };

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.navBar}>
        <Pressable style={st.navBack} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color="#1A1208" />
        </Pressable>
        <Text style={st.navTitle}>Profili Düzenle</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* Avatar */}
        <View style={st.avatarSection}>
          <Pressable onPress={handleAvatarPick} disabled={uploadingAvatar}>
            <View style={st.avatar}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={st.avatarImage} />
              ) : (
                <Text style={st.avatarText}>{initial}</Text>
              )}
              {uploadingAvatar && (
                <View style={st.avatarOverlay}>
                  <Ionicons name="hourglass-outline" size={24} color="#fff" />
                </View>
              )}
            </View>
          </Pressable>
          <Pressable style={st.avatarChangeBtn} onPress={handleAvatarPick} disabled={uploadingAvatar}>
            <Ionicons name="camera-outline" size={16} color={colors.primary} />
            <Text style={st.avatarChangeText}>{uploadingAvatar ? 'Yükleniyor...' : 'Fotoğraf Değiştir'}</Text>
          </Pressable>
        </View>

        {/* Form */}
        <View style={st.formSection}>
          <View style={st.field}>
            <Text style={st.label}>Ad Soyad</Text>
            <View style={st.inputWrap}>
              <Ionicons name="person-outline" size={18} color="#A89A8A" />
              <TextInput
                style={st.input}
                value={name}
                onChangeText={setName}
                placeholder="Adınız ve soyadınız"
                placeholderTextColor="#C4B8AA"
                autoCapitalize="words"
              />
            </View>
          </View>

          <View style={st.field}>
            <Text style={st.label}>Telefon Numarası</Text>
            <View style={st.inputWrap}>
              <Ionicons name="call-outline" size={18} color="#A89A8A" />
              <TextInput
                style={st.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="05XX XXX XX XX"
                placeholderTextColor="#C4B8AA"
                keyboardType="phone-pad"
              />
            </View>
          </View>

          <View style={st.field}>
            <Text style={st.label}>E-posta (yakında)</Text>
            <View style={[st.inputWrap, st.inputDisabled]}>
              <Ionicons name="mail-outline" size={18} color="#C4B8AA" />
              <TextInput
                style={[st.input, { color: '#C4B8AA' }]}
                value=""
                placeholder="Henüz eklenmedi"
                placeholderTextColor="#C4B8AA"
                editable={false}
              />
            </View>
          </View>
        </View>

        {/* Info card */}
        <View style={st.infoCard}>
          <Ionicons name="shield-checkmark-outline" size={18} color="#2E7D32" />
          <Text style={st.infoText}>
            Bilgileriniz güvenle saklanır ve üçüncü şahıslarla paylaşılmaz.
          </Text>
        </View>

        {/* Save button */}
        <Pressable
          style={[st.saveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={st.saveBtnText}>{saving ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#F0ECE6',
  },
  navBack: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F0EA', alignItems: 'center', justifyContent: 'center' },
  navTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208' },

  scroll: { padding: 20, paddingBottom: 40 },

  avatarSection: { alignItems: 'center', marginBottom: 28 },
  avatar: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12, overflow: 'hidden',
  },
  avatarImage: { width: 80, height: 80, borderRadius: 40 },
  avatarText: { fontSize: 32, fontWeight: '700', color: '#fff' },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center', borderRadius: 40,
  },
  avatarChangeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: colors.primary + '40', backgroundColor: colors.primary + '08',
  },
  avatarChangeText: { fontSize: 13, fontWeight: '600', color: colors.primary },

  formSection: { gap: 16, marginBottom: 20 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '700', color: '#6B5E50', marginLeft: 4 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#EDE8E2',
    paddingHorizontal: 14, paddingVertical: 14,
  },
  inputDisabled: { backgroundColor: '#F7F3EE' },
  input: { flex: 1, fontSize: 15, color: '#1A1208', padding: 0 },

  infoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#E8F5E9', borderRadius: 12, padding: 14, marginBottom: 24,
  },
  infoText: { flex: 1, fontSize: 12, color: '#2E7D32', lineHeight: 18 },

  saveBtn: {
    backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
