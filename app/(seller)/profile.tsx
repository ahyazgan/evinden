import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { colors } from '@/constants/theme';
import type { Seller } from '@/types';

type FormState = {
  display_name: string;
  bio: string;
  city: string;
  district: string;
  address_line: string;
};

export default function SellerProfileScreen() {
  const { profile, refreshProfile } = useAuth();
  const [seller, setSeller] = useState<Seller | null>(null);
  const [form, setForm] = useState<FormState>({
    display_name: '',
    bio: '',
    city: '',
    district: '',
    address_line: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    loadSeller();
  }, []);

  async function loadSeller() {
    if (!profile) return;
    const { data } = await supabase
      .from('sellers')
      .select('*')
      .eq('user_id', profile.id)
      .maybeSingle();

    if (data) {
      setSeller(data as Seller);
      setForm({
        display_name: data.display_name ?? '',
        bio: data.bio ?? '',
        city: data.city ?? '',
        district: data.district ?? '',
        address_line: data.address_line ?? '',
      });
    } else {
      // İlk kez; display_name olarak kullanıcı adını önerelim
      setForm((f) => ({ ...f, display_name: profile.name ?? '' }));
    }
    setLoading(false);
  }

  async function handleSave() {
    if (!profile) return;
    const nameTrimmed = form.display_name.trim();
    if (!nameTrimmed) {
      Alert.alert('Hata', 'Mağaza adı boş olamaz.');
      return;
    }

    setSaving(true);
    const payload = {
      display_name: nameTrimmed,
      bio: form.bio.trim() || null,
      city: form.city.trim() || null,
      district: form.district.trim() || null,
      address_line: form.address_line.trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (seller) {
      const { error } = await supabase
        .from('sellers')
        .update(payload)
        .eq('id', seller.id);
      if (error) {
        Alert.alert('Hata', 'Profil güncellenemedi.');
      } else {
        Alert.alert('Başarılı', 'Profil kaydedildi.');
        await loadSeller();
      }
    } else {
      const { error } = await supabase
        .from('sellers')
        .insert({ ...payload, user_id: profile.id });
      if (error) {
        Alert.alert('Hata', 'Profil oluşturulamadı.');
      } else {
        Alert.alert('Başarılı', 'Mağaza profili oluşturuldu.');
        await loadSeller();
      }
    }
    setSaving(false);
  }

  async function handleLogout() {
    Alert.alert('Çıkış', 'Hesabından çıkmak istediğine emin misin?', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Çıkış Yap',
        style: 'destructive',
        onPress: async () => {
          setLoggingOut(true);
          await supabase.auth.signOut();
          await refreshProfile();
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Mağaza Ayarları</Text>

        {/* Puan bilgisi varsa göster */}
        {seller && seller.rating_count > 0 ? (
          <View style={styles.ratingBanner}>
            <Text style={styles.ratingText}>
              ★ {Number(seller.rating_avg).toFixed(1)} · {seller.rating_count} değerlendirme
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>Mağaza Bilgileri</Text>

        <Text style={styles.fieldLabel}>Mağaza Adı *</Text>
        <TextInput
          style={styles.input}
          value={form.display_name}
          onChangeText={(t) => setForm((f) => ({ ...f, display_name: t }))}
          placeholder="örn. Ayşe Hanım'ın Mutfağı"
          placeholderTextColor="#bbb"
        />

        <Text style={styles.fieldLabel}>Hakkında</Text>
        <TextInput
          style={[styles.input, styles.inputMulti]}
          value={form.bio}
          onChangeText={(t) => setForm((f) => ({ ...f, bio: t }))}
          placeholder="Kendinizi ve yemeklerinizi kısaca tanıtın..."
          placeholderTextColor="#bbb"
          multiline
          numberOfLines={4}
        />

        <Text style={styles.sectionLabel}>Konum</Text>

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Şehir</Text>
            <TextInput
              style={styles.input}
              value={form.city}
              onChangeText={(t) => setForm((f) => ({ ...f, city: t }))}
              placeholder="İstanbul"
              placeholderTextColor="#bbb"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>İlçe</Text>
            <TextInput
              style={styles.input}
              value={form.district}
              onChangeText={(t) => setForm((f) => ({ ...f, district: t }))}
              placeholder="Kadıköy"
              placeholderTextColor="#bbb"
            />
          </View>
        </View>

        <Text style={styles.fieldLabel}>Adres</Text>
        <TextInput
          style={[styles.input, styles.inputMulti]}
          value={form.address_line}
          onChangeText={(t) => setForm((f) => ({ ...f, address_line: t }))}
          placeholder="Mahalle, cadde, kapı no..."
          placeholderTextColor="#bbb"
          multiline
          numberOfLines={2}
        />

        <Pressable
          style={[styles.saveBtn, saving && styles.btnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Kaydet</Text>
          )}
        </Pressable>

        <Pressable
          style={[styles.logoutBtn, loggingOut && styles.btnDisabled]}
          onPress={handleLogout}
          disabled={loggingOut}
        >
          <Text style={styles.logoutBtnText}>Çıkış Yap</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 48 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.secondary,
    marginBottom: 16,
    marginTop: 8,
  },
  ratingBanner: {
    backgroundColor: colors.amber + '20',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  ratingText: { fontSize: 15, fontWeight: '700', color: colors.amber },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#aaa',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
    marginTop: 8,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.secondary,
    borderWidth: 1,
    borderColor: '#eee',
    marginBottom: 16,
  },
  inputMulti: { height: 90, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 12 },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  logoutBtn: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e55',
  },
  logoutBtnText: { color: '#e55', fontWeight: '700', fontSize: 16 },
  btnDisabled: { opacity: 0.6 },
});
