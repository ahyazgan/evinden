import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import type { MenuItem, Seller } from '@/types';

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

type FormState = {
  title: string;
  description: string;
  priceStr: string;
};

const EMPTY_FORM: FormState = { title: '', description: '', priceStr: '' };

export default function SellerMenuScreen() {
  const { profile } = useAuth();
  const [seller, setSeller] = useState<Seller | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<MenuItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!profile) return;
    const { data: sellerData } = await supabase
      .from('sellers')
      .select('*')
      .eq('user_id', profile.id)
      .maybeSingle();

    if (!sellerData) {
      setSeller(null);
      setLoading(false);
      return;
    }
    setSeller(sellerData as Seller);

    const { data: menuData } = await supabase
      .from('menu_items')
      .select('*')
      .eq('seller_id', sellerData.id)
      .order('created_at');
    setItems((menuData as MenuItem[]) ?? []);
  }, [profile]);

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const openAdd = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setModalVisible(true);
  };

  const openEdit = (item: MenuItem) => {
    setEditTarget(item);
    setForm({
      title: item.title,
      description: item.description ?? '',
      priceStr: (item.price_cents / 100).toFixed(2).replace('.', ','),
    });
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditTarget(null);
    setForm(EMPTY_FORM);
  };

  const saveItem = async () => {
    if (!seller) return;
    const title = form.title.trim();
    if (!title) {
      Alert.alert('Ürün adı gerekli');
      return;
    }
    const priceNum = parseFloat(form.priceStr.replace(',', '.'));
    if (isNaN(priceNum) || priceNum < 0) {
      Alert.alert('Geçersiz fiyat', 'Lütfen geçerli bir fiyat girin.');
      return;
    }
    const priceCents = Math.round(priceNum * 100);

    setSaving(true);

    if (editTarget) {
      const { error } = await supabase
        .from('menu_items')
        .update({
          title,
          description: form.description.trim() || null,
          price_cents: priceCents,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editTarget.id);

      if (!error) {
        setItems(prev =>
          prev.map(i =>
            i.id === editTarget.id
              ? { ...i, title, description: form.description.trim() || null, price_cents: priceCents }
              : i,
          ),
        );
      } else {
        Alert.alert('Hata', error.message);
      }
    } else {
      const { data, error } = await supabase
        .from('menu_items')
        .insert({
          seller_id: seller.id,
          title,
          description: form.description.trim() || null,
          price_cents: priceCents,
          is_available: true,
        })
        .select()
        .single();

      if (!error && data) {
        setItems(prev => [...prev, data as MenuItem]);
      } else if (error) {
        Alert.alert('Hata', error.message);
      }
    }

    setSaving(false);
    closeModal();
  };

  const toggleAvailability = async (item: MenuItem) => {
    const newVal = !item.is_available;
    const { error } = await supabase
      .from('menu_items')
      .update({ is_available: newVal, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    if (!error) {
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, is_available: newVal } : i)));
    }
  };

  const deleteItem = (item: MenuItem) => {
    Alert.alert(
      'Ürünü Sil',
      `"${item.title}" silinecek. Emin misiniz?`,
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('menu_items').delete().eq('id', item.id);
            if (!error) {
              setItems(prev => prev.filter(i => i.id !== item.id));
            } else {
              Alert.alert('Hata', error.message);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!seller) {
    return (
      <View style={styles.center}>
        <Text style={styles.infoText}>Önce Panel sekmesinden mağazanı oluştur.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Menüm</Text>
        <Pressable style={styles.addBtn} onPress={openAdd}>
          <Text style={styles.addBtnText}>+ Ürün Ekle</Text>
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => (
          <View style={[styles.itemCard, !item.is_available && styles.itemCardInactive]}>
            <View style={styles.itemMain}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              {item.description ? (
                <Text style={styles.itemDesc} numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}
              <Text style={styles.itemPrice}>{priceTL(item.price_cents)}</Text>
            </View>
            <View style={styles.itemActions}>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>
                  {item.is_available ? 'Aktif' : 'Pasif'}
                </Text>
                <Switch
                  value={item.is_available}
                  onValueChange={() => toggleAvailability(item)}
                  trackColor={{ true: colors.primary, false: '#E0E0E0' }}
                  thumbColor="#fff"
                />
              </View>
              <View style={styles.actionBtns}>
                <Pressable
                  style={styles.editBtn}
                  onPress={() => openEdit(item)}
                  hitSlop={8}
                >
                  <Text style={styles.editBtnText}>Düzenle</Text>
                </Pressable>
                <Pressable
                  style={styles.deleteBtn}
                  onPress={() => deleteItem(item)}
                  hitSlop={8}
                >
                  <Text style={styles.deleteBtnText}>Sil</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🍽️</Text>
            <Text style={styles.emptyTitle}>Menün boş</Text>
            <Text style={styles.emptyBody}>
              İlk ürününü ekleyerek başla.
            </Text>
          </View>
        }
      />

      {/* Ekle / Düzenle Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <SafeAreaView style={styles.modalSafe}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {editTarget ? 'Ürünü Düzenle' : 'Yeni Ürün'}
                </Text>
                <Pressable onPress={closeModal} hitSlop={12}>
                  <Text style={styles.modalClose}>✕</Text>
                </Pressable>
              </View>

              <Text style={styles.label}>Ürün Adı *</Text>
              <TextInput
                style={styles.input}
                value={form.title}
                onChangeText={t => setForm(f => ({ ...f, title: t }))}
                placeholder="Mercimek Çorbası"
                placeholderTextColor="#AAAAAA"
                editable={!saving}
              />

              <Text style={[styles.label, { marginTop: 14 }]}>Açıklama</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={form.description}
                onChangeText={t => setForm(f => ({ ...f, description: t }))}
                placeholder="Malzemeler, porsiyon büyüklüğü..."
                placeholderTextColor="#AAAAAA"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                editable={!saving}
              />

              <Text style={[styles.label, { marginTop: 14 }]}>Fiyat (₺) *</Text>
              <TextInput
                style={styles.input}
                value={form.priceStr}
                onChangeText={t => setForm(f => ({ ...f, priceStr: t }))}
                placeholder="45,00"
                placeholderTextColor="#AAAAAA"
                keyboardType="decimal-pad"
                editable={!saving}
              />

              <Pressable
                style={[styles.saveBtn, saving && styles.btnDisabled]}
                onPress={saveItem}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {editTarget ? 'Güncelle' : 'Ekle'}
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  infoText: { fontSize: 15, color: '#888', textAlign: 'center' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EBE3',
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.secondary },
  addBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  list: { padding: 16, paddingBottom: 32 },

  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F0EBE3',
    gap: 10,
  },
  itemCardInactive: { opacity: 0.6 },
  itemMain: { flex: 1 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: colors.secondary, marginBottom: 4 },
  itemDesc: { fontSize: 13, color: '#888', lineHeight: 18, marginBottom: 6 },
  itemPrice: { fontSize: 15, fontWeight: '800', color: colors.primary },

  itemActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F5F0EA',
    paddingTop: 10,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  switchLabel: { fontSize: 12, color: '#888', fontWeight: '600' },
  actionBtns: { flexDirection: 'row', gap: 8 },
  editBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F5F0EA',
  },
  editBtnText: { fontSize: 12, fontWeight: '700', color: colors.secondary },
  deleteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FFEBEE',
  },
  deleteBtnText: { fontSize: 12, fontWeight: '700', color: '#C62828' },

  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 56, lineHeight: 64 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.secondary, marginTop: 12 },
  emptyBody: { fontSize: 14, color: '#888', textAlign: 'center', marginTop: 8, lineHeight: 20 },

  // Modal
  modalSafe: { flex: 1, backgroundColor: colors.background },
  modalScroll: { padding: 20, paddingBottom: 40 },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.secondary },
  modalClose: { fontSize: 20, color: '#888' },
  label: { fontSize: 13, fontWeight: '600', color: colors.secondary, marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E4DD',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.secondary,
  },
  inputMulti: { height: 80, paddingTop: 12 },
  saveBtn: {
    marginTop: 28,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.7 },
  saveBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
