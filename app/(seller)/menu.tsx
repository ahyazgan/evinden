import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { colors } from '@/constants/theme';
import type { MenuItem } from '@/types';

type FormState = {
  title: string;
  description: string;
  price: string; // TL olarak gösterilir, cents'e çevrilir
  is_available: boolean;
};

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  price: '',
  is_available: true,
};

export default function SellerMenuScreen() {
  const { profile } = useAuth();
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    initSeller();
  }, []);

  async function initSeller() {
    if (!profile) return;
    const { data } = await supabase
      .from('sellers')
      .select('id')
      .eq('user_id', profile.id)
      .maybeSingle();
    if (data) {
      setSellerId(data.id);
      await loadItems(data.id);
    }
    setLoading(false);
  }

  async function loadItems(sid: string) {
    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .eq('seller_id', sid)
      .order('created_at', { ascending: false });
    setItems(data ?? []);
  }

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalVisible(true);
  }

  function openEdit(item: MenuItem) {
    setEditing(item);
    setForm({
      title: item.title,
      description: item.description ?? '',
      price: (item.price_cents / 100).toFixed(2),
      is_available: item.is_available,
    });
    setModalVisible(true);
  }

  async function handleSave() {
    if (!sellerId) return;
    const titleTrimmed = form.title.trim();
    if (!titleTrimmed) {
      Alert.alert('Hata', 'Yemek adı boş olamaz.');
      return;
    }
    const priceNum = parseFloat(form.price.replace(',', '.'));
    if (isNaN(priceNum) || priceNum <= 0) {
      Alert.alert('Hata', 'Geçerli bir fiyat girin.');
      return;
    }

    setSaving(true);
    const payload = {
      title: titleTrimmed,
      description: form.description.trim() || null,
      price_cents: Math.round(priceNum * 100),
      is_available: form.is_available,
      updated_at: new Date().toISOString(),
    };

    if (editing) {
      const { error } = await supabase
        .from('menu_items')
        .update(payload)
        .eq('id', editing.id);
      if (error) {
        Alert.alert('Hata', 'Güncelleme başarısız.');
      }
    } else {
      const { error } = await supabase
        .from('menu_items')
        .insert({ ...payload, seller_id: sellerId });
      if (error) {
        Alert.alert('Hata', 'Eklenemedi.');
      }
    }

    setSaving(false);
    setModalVisible(false);
    await loadItems(sellerId);
  }

  function handleDelete(item: MenuItem) {
    Alert.alert(
      'Sil',
      `"${item.title}" menüden kaldırılsın mı?`,
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('menu_items').delete().eq('id', item.id);
            if (sellerId) await loadItems(sellerId);
          },
        },
      ],
    );
  }

  async function toggleAvailability(item: MenuItem) {
    await supabase
      .from('menu_items')
      .update({ is_available: !item.is_available, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    if (sellerId) await loadItems(sellerId);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Başlık */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Menüm</Text>
          <Text style={styles.sub}>{items.length} yemek</Text>
        </View>
        <Pressable style={styles.addBtn} onPress={openAdd}>
          <Text style={styles.addBtnText}>+ Ekle</Text>
        </Pressable>
      </View>

      {items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Henüz yemek eklemediniz.</Text>
          <Pressable style={styles.addBtn} onPress={openAdd}>
            <Text style={styles.addBtnText}>İlk Yemeği Ekle</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingBottom: 32 }}
          renderItem={({ item }) => (
            <View style={[styles.itemCard, !item.is_available && styles.itemCardInactive]}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                {item.description ? (
                  <Text style={styles.itemDesc} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
                <Text style={styles.itemPrice}>
                  {(item.price_cents / 100).toLocaleString('tr-TR', {
                    style: 'currency',
                    currency: 'TRY',
                  })}
                </Text>
              </View>

              <View style={styles.itemActions}>
                <Switch
                  value={item.is_available}
                  onValueChange={() => toggleAvailability(item)}
                  trackColor={{ true: colors.success, false: '#ddd' }}
                  thumbColor="#fff"
                />
                <Pressable onPress={() => openEdit(item)} style={styles.editBtn}>
                  <Text style={styles.editBtnText}>Düzenle</Text>
                </Pressable>
                <Pressable onPress={() => handleDelete(item)}>
                  <Text style={styles.deleteText}>Sil</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}

      {/* Add/Edit Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            style={styles.modal}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editing ? 'Yemeği Düzenle' : 'Yeni Yemek'}
              </Text>
              <Pressable onPress={() => setModalVisible(false)}>
                <Text style={styles.modalClose}>İptal</Text>
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Yemek Adı *</Text>
            <TextInput
              style={styles.input}
              value={form.title}
              onChangeText={(t) => setForm((f) => ({ ...f, title: t }))}
              placeholder="örn. Mercimek Çorbası"
              placeholderTextColor="#bbb"
            />

            <Text style={styles.fieldLabel}>Açıklama</Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              value={form.description}
              onChangeText={(t) => setForm((f) => ({ ...f, description: t }))}
              placeholder="Kısa bir tanıtım yazısı..."
              placeholderTextColor="#bbb"
              multiline
              numberOfLines={3}
            />

            <Text style={styles.fieldLabel}>Fiyat (₺) *</Text>
            <TextInput
              style={styles.input}
              value={form.price}
              onChangeText={(t) => setForm((f) => ({ ...f, price: t }))}
              placeholder="0.00"
              placeholderTextColor="#bbb"
              keyboardType="decimal-pad"
            />

            <View style={styles.switchRow}>
              <Text style={styles.fieldLabel}>Stokta var</Text>
              <Switch
                value={form.is_available}
                onValueChange={(v) => setForm((f) => ({ ...f, is_available: v }))}
                trackColor={{ true: colors.success, false: '#ddd' }}
                thumbColor="#fff"
              />
            </View>

            <Pressable
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>
                  {editing ? 'Kaydet' : 'Ekle'}
                </Text>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 12,
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.secondary },
  sub: { fontSize: 13, color: '#999', marginTop: 2 },
  addBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  emptyText: { fontSize: 15, color: '#aaa' },
  itemCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 12,
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  itemCardInactive: { opacity: 0.55 },
  itemInfo: { flex: 1, gap: 3 },
  itemTitle: { fontSize: 15, fontWeight: '600', color: colors.secondary },
  itemDesc: { fontSize: 13, color: '#888', lineHeight: 18 },
  itemPrice: { fontSize: 14, fontWeight: '700', color: colors.primary, marginTop: 4 },
  itemActions: { alignItems: 'flex-end', gap: 8, justifyContent: 'center' },
  editBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  editBtnText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  deleteText: { color: '#e55', fontSize: 12 },
  // Modal
  modal: { flex: 1, backgroundColor: '#fff' },
  modalContent: { padding: 20, paddingBottom: 48 },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.secondary },
  modalClose: { fontSize: 15, color: colors.primary },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 6 },
  input: {
    backgroundColor: colors.background,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.secondary,
    borderWidth: 1,
    borderColor: '#eee',
    marginBottom: 16,
  },
  inputMulti: { height: 80, textAlignVertical: 'top' },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
