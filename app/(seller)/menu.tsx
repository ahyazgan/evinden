import { useState } from 'react';
import {
  Alert,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/constants/theme';

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

type Category = { id: string; label: string; icon: string };

const CATEGORIES: Category[] = [
  { id: 'corba', label: 'Çorbalar', icon: '🥣' },
  { id: 'ana', label: 'Ana Yemekler', icon: '🍲' },
  { id: 'salata', label: 'Salatalar', icon: '🥗' },
  { id: 'tatli', label: 'Tatlılar', icon: '🍰' },
  { id: 'icecek', label: 'İçecekler', icon: '🥤' },
  { id: 'diger', label: 'Diğer', icon: '📦' },
];

type MenuItem = {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  is_available: boolean;
  stock: number; // -1 = unlimited
  category: string;
};

const INITIAL_ITEMS: MenuItem[] = [
  { id: 'm1', title: 'Mercimek Çorbası', description: 'Günlük taze pişirilen kırmızı mercimek çorbası.', price_cents: 4500, is_available: true, stock: -1, category: 'corba' },
  { id: 'm2', title: 'Kuru Fasulye + Pilav', description: 'Geleneksel tarif ile pişirilmiş kuru fasulye, yanında tereyağlı pirinç pilavı.', price_cents: 8000, is_available: true, stock: 12, category: 'ana' },
  { id: 'm3', title: 'İzmir Köfte', description: 'Domates soslu fırın köfte, patates ve biber ile.', price_cents: 9500, is_available: true, stock: 5, category: 'ana' },
  { id: 'm4', title: 'Karışık Salata', description: 'Mevsim yeşillikleri, domates, salatalık, zeytin.', price_cents: 3500, is_available: false, stock: 0, category: 'salata' },
];

type FormState = { title: string; description: string; priceStr: string; stockStr: string; category: string };
const EMPTY_FORM: FormState = { title: '', description: '', priceStr: '', stockStr: '', category: 'ana' };

export default function SellerMenuScreen() {
  const [items, setItems] = useState<MenuItem[]>(INITIAL_ITEMS);
  const [modalVisible, setModalVisible] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [filterCat, setFilterCat] = useState('all');

  const openAdd = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setModalVisible(true);
  };

  const openEdit = (item: MenuItem) => {
    setEditId(item.id);
    setForm({
      title: item.title,
      description: item.description,
      priceStr: (item.price_cents / 100).toFixed(2).replace('.', ','),
      stockStr: item.stock === -1 ? '' : String(item.stock),
      category: item.category,
    });
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditId(null);
    setForm(EMPTY_FORM);
  };

  const saveItem = () => {
    const title = form.title.trim();
    if (!title) { Alert.alert('Ürün adı gerekli'); return; }
    const priceNum = parseFloat(form.priceStr.replace(',', '.'));
    if (isNaN(priceNum) || priceNum < 0) { Alert.alert('Geçersiz fiyat'); return; }
    const priceCents = Math.round(priceNum * 100);

    const stock = form.stockStr.trim() === '' ? -1 : parseInt(form.stockStr, 10);

    if (editId) {
      setItems(prev =>
        prev.map(i =>
          i.id === editId
            ? { ...i, title, description: form.description.trim(), price_cents: priceCents, stock, category: form.category }
            : i,
        ),
      );
    } else {
      const newItem: MenuItem = {
        id: `m${Date.now()}`,
        title,
        description: form.description.trim(),
        price_cents: priceCents,
        is_available: true,
        stock,
        category: form.category,
      };
      setItems(prev => [...prev, newItem]);
    }
    closeModal();
  };

  const toggleAvailability = (id: string) => {
    setItems(prev => prev.map(i => (i.id === id ? { ...i, is_available: !i.is_available } : i)));
  };

  const deleteItem = (item: MenuItem) => {
    Alert.alert('Ürünü Sil', `"${item.title}" silinecek.`, [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => setItems(prev => prev.filter(i => i.id !== item.id)) },
    ]);
  };

  const activeCount = items.filter(i => i.is_available).length;
  const filteredItems = filterCat === 'all' ? items : items.filter(i => i.category === filterCat);
  const getCatLabel = (id: string) => CATEGORIES.find(c => c.id === id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Menüm</Text>
          <Text style={styles.headerSub}>{activeCount} aktif · {items.length} toplam</Text>
        </View>
        <Pressable style={styles.addBtn} onPress={openAdd}>
          <Text style={styles.addBtnText}>+ Ekle</Text>
        </Pressable>
      </View>

      {/* Category filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catFilterRow} style={{ flexGrow: 0 }}>
        <Pressable style={[styles.catPill, filterCat === 'all' && styles.catPillActive]} onPress={() => setFilterCat('all')}>
          <Text style={[styles.catPillText, filterCat === 'all' && styles.catPillTextActive]}>Tümü</Text>
        </Pressable>
        {CATEGORIES.map(cat => (
          <Pressable key={cat.id} style={[styles.catPill, filterCat === cat.id && styles.catPillActive]} onPress={() => setFilterCat(cat.id)}>
            <Text style={[styles.catPillText, filterCat === cat.id && styles.catPillTextActive]}>{cat.icon} {cat.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {filteredItems.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🍽️</Text>
            <Text style={styles.emptyTitle}>Menü boş</Text>
            <Text style={styles.emptySub}>Ürün eklemek için + Ekle butonuna bas.</Text>
          </View>
        ) : (
          filteredItems.map(item => (
            <View key={item.id} style={[styles.itemCard, !item.is_available && styles.itemCardInactive]}>
              <View style={styles.itemMain}>
                <View style={styles.itemTop}>
                  <Text style={[styles.itemTitle, !item.is_available && styles.itemTitleInactive]}>
                    {item.title}
                  </Text>
                  {!item.is_available ? (
                    <View style={styles.inactiveBadge}>
                      <Text style={styles.inactiveBadgeText}>Pasif</Text>
                    </View>
                  ) : null}
                </View>
                {getCatLabel(item.category) && (
                  <View style={styles.catBadge}>
                    <Text style={styles.catBadgeText}>{getCatLabel(item.category)!.icon} {getCatLabel(item.category)!.label}</Text>
                  </View>
                )}
                {item.description ? (
                  <Text style={styles.itemDesc} numberOfLines={2}>{item.description}</Text>
                ) : null}
                <View style={styles.priceStockRow}>
                  <Text style={styles.itemPrice}>{priceTL(item.price_cents)}</Text>
                  <View style={[styles.stockBadge, item.stock === 0 && styles.stockBadgeOut, item.stock > 0 && item.stock <= 5 && styles.stockBadgeLow]}>
                    <Text style={[styles.stockBadgeText, item.stock === 0 && styles.stockBadgeTextOut, item.stock > 0 && item.stock <= 5 && styles.stockBadgeTextLow]}>
                      {item.stock === -1 ? '∞ Stok' : item.stock === 0 ? 'Tükendi' : `${item.stock} adet`}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.itemActions}>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>{item.is_available ? 'Aktif' : 'Pasif'}</Text>
                  <Switch
                    value={item.is_available}
                    onValueChange={() => toggleAvailability(item.id)}
                    trackColor={{ true: colors.primary, false: '#E0E0E0' }}
                    thumbColor="#fff"
                  />
                </View>
                <View style={styles.actionBtns}>
                  <Pressable style={styles.editBtn} onPress={() => openEdit(item)}>
                    <Text style={styles.editBtnText}>Düzenle</Text>
                  </Pressable>
                  <Pressable style={styles.deleteBtn} onPress={() => deleteItem(item)}>
                    <Text style={styles.deleteBtnText}>Sil</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Add/Edit Modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <SafeAreaView style={styles.modal} edges={['top', 'bottom']}>
            <View style={styles.modalHeader}>
              <Pressable onPress={closeModal}>
                <Text style={styles.modalCancel}>İptal</Text>
              </Pressable>
              <Text style={styles.modalTitle}>{editId ? 'Ürünü Düzenle' : 'Yeni Ürün'}</Text>
              <Pressable onPress={saveItem}>
                <Text style={styles.modalSave}>Kaydet</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Ürün Adı *</Text>
              <TextInput
                style={styles.input}
                value={form.title}
                onChangeText={t => setForm(f => ({ ...f, title: t }))}
                placeholder="Örn: Mercimek Çorbası"
                placeholderTextColor="#C4B8AA"
              />

              <Text style={[styles.label, { marginTop: 14 }]}>Kategori</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catPickerRow}>
                {CATEGORIES.map(cat => (
                  <Pressable key={cat.id} style={[styles.catPickerPill, form.category === cat.id && styles.catPickerPillActive]} onPress={() => setForm(f => ({ ...f, category: cat.id }))}>
                    <Text style={styles.catPickerIcon}>{cat.icon}</Text>
                    <Text style={[styles.catPickerText, form.category === cat.id && styles.catPickerTextActive]}>{cat.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={[styles.label, { marginTop: 14 }]}>Açıklama</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={form.description}
                onChangeText={t => setForm(f => ({ ...f, description: t }))}
                placeholder="Ürün hakkında kısa bilgi..."
                placeholderTextColor="#C4B8AA"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />

              <Text style={[styles.label, { marginTop: 14 }]}>Fiyat (₺) *</Text>
              <TextInput
                style={styles.input}
                value={form.priceStr}
                onChangeText={t => setForm(f => ({ ...f, priceStr: t }))}
                placeholder="45,00"
                placeholderTextColor="#C4B8AA"
                keyboardType="decimal-pad"
              />

              <Text style={[styles.label, { marginTop: 14 }]}>Stok Adedi</Text>
              <TextInput
                style={styles.input}
                value={form.stockStr}
                onChangeText={t => setForm(f => ({ ...f, stockStr: t }))}
                placeholder="Boş bırakın = sınırsız"
                placeholderTextColor="#C4B8AA"
                keyboardType="number-pad"
              />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E2',
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#1A1208', fontFamily: 'serif' },
  headerSub: { fontSize: 12, color: '#A89A8A', marginTop: 2 },
  addBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  list: { padding: 16, paddingBottom: 40, gap: 10 },

  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 14,
  },
  itemCardInactive: { opacity: 0.6 },
  itemMain: { marginBottom: 10 },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: '#1A1208', flex: 1 },
  itemTitleInactive: { color: '#A89A8A' },
  inactiveBadge: {
    backgroundColor: '#F5F5F5',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  inactiveBadgeText: { fontSize: 10, fontWeight: '700', color: '#9E9E9E' },
  itemDesc: { fontSize: 12, color: '#A89A8A', lineHeight: 17, marginBottom: 6 },
  priceStockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemPrice: { fontSize: 15, fontWeight: '800', color: colors.primary },
  stockBadge: { backgroundColor: '#E8F5E9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  stockBadgeOut: { backgroundColor: '#FFEBEE' },
  stockBadgeLow: { backgroundColor: '#FFF8E1' },
  stockBadgeText: { fontSize: 11, fontWeight: '700', color: '#2E7D32' },
  stockBadgeTextOut: { color: '#C62828' },
  stockBadgeTextLow: { color: '#F57F17' },

  catFilterRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  catPill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EDE8E2' },
  catPillActive: { backgroundColor: '#1A1208', borderColor: '#1A1208' },
  catPillText: { fontSize: 12, fontWeight: '600', color: '#8A7E72' },
  catPillTextActive: { color: '#fff' },
  catBadge: { alignSelf: 'flex-start', backgroundColor: '#F7F3EE', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginBottom: 4 },
  catBadgeText: { fontSize: 10, fontWeight: '700', color: '#6B5E50' },

  catPickerRow: { gap: 8, paddingVertical: 4 },
  catPickerPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: '#EDE8E2', backgroundColor: '#FAFAFA' },
  catPickerPillActive: { borderColor: colors.primary, backgroundColor: '#FFF5F2' },
  catPickerIcon: { fontSize: 16 },
  catPickerText: { fontSize: 13, fontWeight: '600', color: '#6B5E50' },
  catPickerTextActive: { color: colors.primary },

  itemActions: { borderTopWidth: 1, borderTopColor: '#F5F0EA', paddingTop: 10, gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { fontSize: 12, fontWeight: '600', color: '#A89A8A' },
  actionBtns: { flexDirection: 'row', gap: 8 },
  editBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  editBtnText: { fontSize: 12, fontWeight: '700', color: '#1A1208' },
  deleteBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#FFCDD2',
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
    backgroundColor: '#FFF5F5',
  },
  deleteBtnText: { fontSize: 12, fontWeight: '700', color: '#E53935' },

  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#1A1208' },
  emptySub: { fontSize: 13, color: '#A89A8A', textAlign: 'center' },

  // Modal
  modal: { flex: 1, backgroundColor: '#FAF7F2' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E2',
  },
  modalTitle: { fontSize: 15, fontWeight: '800', color: '#1A1208' },
  modalCancel: { fontSize: 15, color: '#A89A8A', fontWeight: '600' },
  modalSave: { fontSize: 15, color: colors.primary, fontWeight: '700' },
  modalScroll: { padding: 20, paddingBottom: 40 },

  label: { fontSize: 13, fontWeight: '700', color: '#1A1208', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1A1208',
  },
  inputMulti: { height: 88, paddingTop: 12 },
});
