import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { useRouter } from 'expo-router';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import ImageUploadBox from '@/components/shared/ImageUploadBox';
import {
  fetchSellerByUserId,
  fetchMenuItems,
  createMenuItem,
  updateMenuItem,
  setMenuItemDailyLimit,
  deleteMenuItem as dbDeleteMenuItem,
  fetchExtras,
  createExtra,
  deleteExtra,
  fetchPortions,
  createPortion,
  deletePortion,
  notifyMyFollowers,
  type ExtraRow,
} from '@/lib/db';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '@/lib/fonts';
import { istanbulToday } from '@/lib/date';

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

type ExtraItem = { id: string; label: string; price_cents: number };
type PortionItem = { id: string; label: string; price_cents: number };

type MenuItem = {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  is_available: boolean;
  stock: number; // -1 = unlimited
  dailyLimit: number; // 0 = unlimited, >0 = max per day
  soldToday: number;
  category: string;
  image_url: string | null;
  scheduleDays: number[]; // 0-6, empty = every day
  extras: ExtraItem[];
  portions: PortionItem[];
};

type FormState = { title: string; description: string; priceStr: string; stockStr: string; category: string; image_url: string | null };
const EMPTY_FORM: FormState = { title: '', description: '', priceStr: '', stockStr: '', category: 'ana', image_url: null };

export default function SellerMenuScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [filterCat, setFilterCat] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Extras state for form
  const [formExtras, setFormExtras] = useState<ExtraItem[]>([]);
  const [newExtraLabel, setNewExtraLabel] = useState('');
  const [newExtraPrice, setNewExtraPrice] = useState('');
  // Portions state for form
  const [formPortions, setFormPortions] = useState<PortionItem[]>([]);
  const [newPortionLabel, setNewPortionLabel] = useState('');
  const [newPortionPrice, setNewPortionPrice] = useState('');

  // Load seller + menu from Supabase, fallback to demo
  useEffect(() => {
    if (!profile?.id) { setLoading(false); setItems([]); return; }
    (async () => {
      try {
        const seller = await fetchSellerByUserId(profile.id);
        if (seller) {
          setSellerId(seller.id);
          const dbItems = await fetchMenuItems(seller.id);
          if (dbItems.length > 0) {
            // Load extras for each item
            const itemsWithExtras = await Promise.all(dbItems.map(async (row) => {
              let extras: ExtraItem[] = [];
              let portions: PortionItem[] = [];
              try {
                const dbExtras = await fetchExtras(row.id);
                extras = dbExtras.map(e => ({ id: e.id, label: e.label, price_cents: e.price_cents }));
              } catch {}
              try {
                const dbPortions = await fetchPortions(row.id);
                portions = dbPortions.map(p => ({ id: p.id, label: p.label, price_cents: p.price_cents }));
              } catch {}
              return {
                id: row.id,
                title: row.title,
                description: row.description ?? '',
                price_cents: row.price_cents,
                is_available: row.is_available,
                stock: (row.daily_limit ?? 0) > 0 ? row.daily_limit! : -1,
                dailyLimit: row.daily_limit ?? 0,
                soldToday: row.stock_reset_date === istanbulToday() ? row.sold_today ?? 0 : 0,
                category: row.category ?? 'ana',
                image_url: row.image_url,
                scheduleDays: [],
                extras,
                portions,
              };
            }));
            setItems(itemsWithExtras);
          } else {
            setItems([]);
          }
        } else {
          setItems([]);
        }
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [profile]);

  const openAdd = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setFormExtras([]);
    setNewExtraLabel('');
    setNewExtraPrice('');
    setFormPortions([]);
    setNewPortionLabel('');
    setNewPortionPrice('');
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
      image_url: item.image_url,
    });
    setFormExtras(item.extras);
    setNewExtraLabel('');
    setNewExtraPrice('');
    setFormPortions(item.portions);
    setNewPortionLabel('');
    setNewPortionPrice('');
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditId(null);
    setForm(EMPTY_FORM);
    setFormExtras([]);
    setFormPortions([]);
  };

  const addExtraToForm = () => {
    const label = newExtraLabel.trim();
    if (!label) { Alert.alert('Ekstra adı gerekli'); return; }
    const priceNum = parseFloat(newExtraPrice.replace(',', '.'));
    if (isNaN(priceNum) || priceNum < 0) { Alert.alert('Geçersiz fiyat'); return; }
    const priceCents = Math.round(priceNum * 100);
    setFormExtras(prev => [...prev, { id: `temp-${Date.now()}`, label, price_cents: priceCents }]);
    setNewExtraLabel('');
    setNewExtraPrice('');
  };

  const removeExtraFromForm = (extraId: string) => {
    setFormExtras(prev => prev.filter(e => e.id !== extraId));
  };

  const addPortionToForm = () => {
    const label = newPortionLabel.trim();
    if (!label) { Alert.alert('Porsiyon adı gerekli'); return; }
    const priceNum = parseFloat(newPortionPrice.replace(',', '.'));
    if (isNaN(priceNum) || priceNum <= 0) { Alert.alert('Geçersiz fiyat'); return; }
    const priceCents = Math.round(priceNum * 100);
    setFormPortions(prev => [...prev, { id: `temp-${Date.now()}`, label, price_cents: priceCents }]);
    setNewPortionLabel('');
    setNewPortionPrice('');
  };

  const removePortionFromForm = (portionId: string) => {
    setFormPortions(prev => prev.filter(p => p.id !== portionId));
  };

  const saveItem = async () => {
    const title = form.title.trim();
    if (!title) { Alert.alert('Ürün adı gerekli'); return; }
    const priceNum = parseFloat(form.priceStr.replace(',', '.'));
    if (isNaN(priceNum) || priceNum < 0) { Alert.alert('Geçersiz fiyat'); return; }
    const priceCents = Math.round(priceNum * 100);
    const stock = form.stockStr.trim() === '' ? -1 : parseInt(form.stockStr, 10);
    if (stock !== -1 && (!Number.isInteger(stock) || stock < 1)) {
      Alert.alert('Geçersiz adet', 'Günlük adet en az 1 olmalı. Sınırsız satış için boş bırak.');
      return;
    }

    setSaving(true);
    try {
      if (editId && sellerId) {
        // Try Supabase update
        try {
          await setMenuItemDailyLimit(editId, stock === -1 ? 0 : stock);
          await updateMenuItem(editId, {
            title,
            description: form.description.trim() || null,
            price_cents: priceCents,
            category: form.category || null,
            image_url: form.image_url,
          });
          // Sync extras: delete removed, add new
          const existingItem = items.find(i => i.id === editId);
          const oldExtras = existingItem?.extras ?? [];
          const removedExtras = oldExtras.filter(oe => !formExtras.some(fe => fe.id === oe.id));
          const addedExtras = formExtras.filter(fe => fe.id.startsWith('temp-'));
          for (const re of removedExtras) {
            try { await deleteExtra(re.id); } catch {}
          }
          const savedNewExtras: ExtraItem[] = [];
          for (const ae of addedExtras) {
            try {
              const saved = await createExtra({ menu_item_id: editId, label: ae.label, price_cents: ae.price_cents });
              savedNewExtras.push({ id: saved.id, label: saved.label, price_cents: saved.price_cents });
            } catch {}
          }
          const finalExtras = [
            ...formExtras.filter(fe => !fe.id.startsWith('temp-')),
            ...savedNewExtras,
          ];
          // Sync portions: delete removed, add new
          const oldPortions = existingItem?.portions ?? [];
          const removedPortions = oldPortions.filter(op => !formPortions.some(fp => fp.id === op.id));
          const addedPortions = formPortions.filter(fp => fp.id.startsWith('temp-'));
          for (const rp of removedPortions) {
            try { await deletePortion(rp.id); } catch {}
          }
          const savedNewPortions: PortionItem[] = [];
          for (const ap of addedPortions) {
            try {
              const saved = await createPortion({ menu_item_id: editId, label: ap.label, price_cents: ap.price_cents });
              savedNewPortions.push({ id: saved.id, label: saved.label, price_cents: saved.price_cents });
            } catch {}
          }
          const finalPortions = [
            ...formPortions.filter(fp => !fp.id.startsWith('temp-')),
            ...savedNewPortions,
          ];
        setItems(prev =>
          prev.map(i =>
            i.id === editId
              ? { ...i, title, description: form.description.trim(), price_cents: priceCents, stock, dailyLimit: stock === -1 ? 0 : stock, category: form.category, image_url: form.image_url, extras: finalExtras, portions: finalPortions }
              : i,
          ),
        );
        } catch (e) {
          throw e; // kayıt olmadıysa satıcıya yansısın
        }
      } else {
        let newId = `m${Date.now()}`;
        // Try Supabase insert
        if (sellerId) {
          try {
            const created = await createMenuItem({
              seller_id: sellerId,
              title,
              description: form.description.trim() || null,
              price_cents: priceCents,
              category: form.category || null,
              image_url: form.image_url,
            });
            newId = created.id;
            if (stock !== -1) await setMenuItemDailyLimit(newId, stock);
            // Save extras
            for (const extra of formExtras) {
              try {
                await createExtra({ menu_item_id: newId, label: extra.label, price_cents: extra.price_cents });
              } catch {}
            }
            // Save portions
            for (const portion of formPortions) {
              try {
                await createPortion({ menu_item_id: newId, label: portion.label, price_cents: portion.price_cents });
              } catch {}
            }
          } catch (e) {
            throw e; // kayıt olmadıysa satıcıya yansısın
          }
        }
        // Notify customers who favorited this seller
        if (sellerId) {
          notifyMyFollowers('Yeni Yemek Eklendi! 🍽️', `${title} menüye eklendi. Şimdi sipariş ver!`).catch(() => {});
        }
        // Reload extras from DB for correct IDs
        let savedExtras: ExtraItem[] = [];
        try {
          const dbExtras = await fetchExtras(newId);
          savedExtras = dbExtras.map(e => ({ id: e.id, label: e.label, price_cents: e.price_cents }));
        } catch {
          savedExtras = formExtras;
        }
        // Reload portions from DB for correct IDs
        let savedPortions: PortionItem[] = [];
        try {
          const dbPortions = await fetchPortions(newId);
          savedPortions = dbPortions.map(p => ({ id: p.id, label: p.label, price_cents: p.price_cents }));
        } catch {
          savedPortions = formPortions;
        }
        const newItem: MenuItem = {
          id: newId,
          title,
          description: form.description.trim(),
          price_cents: priceCents,
          is_available: true,
          stock,
          dailyLimit: stock === -1 ? 0 : stock,
          soldToday: 0,
          category: form.category,
          image_url: form.image_url,
          scheduleDays: [],
          extras: savedExtras,
          portions: savedPortions,
        };
        setItems(prev => [...prev, newItem]);
      }
      closeModal();
    } catch (err: any) {
      Alert.alert('Kaydedilemedi', err?.message ?? 'Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  const toggleAvailability = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    setItems(prev => prev.map(i => (i.id === id ? { ...i, is_available: !item.is_available } : i)));
    if (sellerId) {
      try {
        await updateMenuItem(id, { is_available: !item.is_available });
      } catch {
        setItems(prev => prev.map(i => (i.id === id ? { ...i, is_available: item.is_available } : i)));
        Alert.alert('Güncellenemedi', 'Lütfen tekrar dene.');
      }
    }
  };

  const deleteItem = (item: MenuItem) => {
    Alert.alert('Ürünü Sil', `"${item.title}" silinecek.`, [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Sil', style: 'destructive', onPress: async () => {
          setItems(prev => prev.filter(i => i.id !== item.id));
          if (sellerId) {
            try { await dbDeleteMenuItem(item.id); } catch {}
          }
        },
      },
    ]);
  };

  const activeCount = items.filter(i => i.is_available).length;
  const filteredItems = filterCat === 'all' ? items : items.filter(i => i.category === filterCat);
  const getCatLabel = (id: string) => CATEGORIES.find(c => c.id === id);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ marginTop: 12, color: '#6B766F', fontFamily: fonts.regular, fontSize: 13 }}>Menü yükleniyor...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Menüm</Text>
          <Text style={styles.headerSub}>{activeCount} aktif · {items.length} toplam</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            style={styles.calendarBtn}
            onPress={() => router.push('/(seller)/weekly-menu')}
            hitSlop={8}
          >
            <Ionicons name="calendar-outline" size={20} color={colors.primary} />
          </Pressable>
          <Pressable style={styles.addBtn} onPress={openAdd}>
            <Text style={styles.addBtnText}>+ Ekle</Text>
          </Pressable>
        </View>
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
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={styles.itemImage} />
              ) : null}
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
                      {item.stock === -1 ? 'Sınırsız' : item.stock - item.soldToday <= 0 ? 'Bugünlük bitti' : `${item.stock - item.soldToday}/${item.stock} kaldı`}
                    </Text>
                  </View>
                </View>
                {/* Daily limit & schedule info */}
                <View style={styles.extraInfoRow}>
                  {item.dailyLimit > 0 && (
                    <View style={styles.dailyLimitBadge}>
                      <Text style={styles.dailyLimitText}>
                        📊 {item.soldToday}/{item.dailyLimit} günlük
                      </Text>
                    </View>
                  )}
                  {item.scheduleDays.length > 0 && (
                    <View style={styles.scheduleBadge}>
                      <Text style={styles.scheduleText}>
                        📅 {item.scheduleDays.map(d => ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'][d]).join(', ')}
                      </Text>
                    </View>
                  )}
                </View>
                {item.extras.length > 0 && (
                  <View style={styles.extrasRow}>
                    <Text style={styles.extrasLabel}>Ekstralar:</Text>
                    {item.extras.map(ex => (
                      <View key={ex.id} style={styles.extraBadge}>
                        <Text style={styles.extraBadgeText}>
                          {ex.label} +₺{(ex.price_cents / 100).toFixed(0)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
                {item.portions.length > 0 && (
                  <View style={styles.extrasRow}>
                    <Text style={styles.extrasLabel}>Porsiyonlar:</Text>
                    {item.portions.map(p => (
                      <View key={p.id} style={styles.portionBadge}>
                        <Text style={styles.portionBadgeText}>
                          {p.label} ₺{(p.price_cents / 100).toFixed(0)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
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
              <Pressable onPress={saveItem} disabled={saving}>
                <Text style={[styles.modalSave, saving && { opacity: 0.5 }]}>{saving ? 'Kaydediliyor...' : 'Kaydet'}</Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.imageUploadSection}>
                <ImageUploadBox
                  imageUrl={form.image_url}
                  fallbackEmoji="📷"
                  fallbackBg="#EFF2EA"
                  bucket="food-images"
                  path={`menu/${sellerId ?? 'local'}/${editId ?? `new-${Date.now()}`}`}
                  aspect={[4, 3]}
                  size={100}
                  borderRadius={16}
                  onUploaded={(url) => setForm(f => ({ ...f, image_url: url }))}
                />
                <Text style={styles.imageUploadHint}>Ürün Fotoğrafı Ekle</Text>
              </View>

              <Text style={styles.label}>Ürün Adı *</Text>
              <TextInput
                style={styles.input}
                value={form.title}
                onChangeText={t => setForm(f => ({ ...f, title: t }))}
                placeholder="Örn: Mercimek Çorbası"
                placeholderTextColor="#A3ACA5"
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
                placeholderTextColor="#A3ACA5"
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
                placeholderTextColor="#A3ACA5"
                keyboardType="decimal-pad"
              />

              <Text style={[styles.label, { marginTop: 14 }]}>Günlük adet</Text>
              <TextInput
                style={styles.input}
                value={form.stockStr}
                onChangeText={t => setForm(f => ({ ...f, stockStr: t }))}
                placeholder="Boş bırakırsan sınırsız"
                placeholderTextColor="#A3ACA5"
                keyboardType="number-pad"
              />

              {/* Extras Section */}
              <Text style={[styles.label, { marginTop: 20 }]}>Ekstra Seçenekler</Text>
              <Text style={styles.extrasHint}>Müşterinin sipariş sırasında ekleyebileceği opsiyonlar (Ekstra peynir, Sos, vb.)</Text>

              {formExtras.map(extra => (
                <View key={extra.id} style={styles.extraFormRow}>
                  <View style={styles.extraFormInfo}>
                    <Text style={styles.extraFormLabel}>{extra.label}</Text>
                    <Text style={styles.extraFormPrice}>+₺{(extra.price_cents / 100).toFixed(2).replace('.', ',')}</Text>
                  </View>
                  <Pressable style={styles.extraRemoveBtn} onPress={() => removeExtraFromForm(extra.id)}>
                    <Ionicons name="close-circle" size={22} color="#E53935" />
                  </Pressable>
                </View>
              ))}

              <View style={styles.extraAddRow}>
                <TextInput
                  style={[styles.input, styles.extraAddInput]}
                  value={newExtraLabel}
                  onChangeText={setNewExtraLabel}
                  placeholder="Ekstra adı (ör: Ekstra Peynir)"
                  placeholderTextColor="#A3ACA5"
                />
                <TextInput
                  style={[styles.input, styles.extraAddPrice]}
                  value={newExtraPrice}
                  onChangeText={setNewExtraPrice}
                  placeholder="₺"
                  placeholderTextColor="#A3ACA5"
                  keyboardType="decimal-pad"
                />
                <Pressable style={styles.extraAddBtn} onPress={addExtraToForm}>
                  <Ionicons name="add-circle" size={28} color={colors.primary} />
                </Pressable>
              </View>

              {/* Portions Section */}
              <Text style={[styles.label, { marginTop: 20 }]}>Porsiyon Seçenekleri</Text>
              <Text style={styles.extrasHint}>Farklı porsiyon boyutları ekle (1 Kişilik, 2 Kişilik, Aile Boyu)</Text>

              {formPortions.map(portion => (
                <View key={portion.id} style={styles.extraFormRow}>
                  <View style={styles.extraFormInfo}>
                    <Text style={styles.extraFormLabel}>{portion.label}</Text>
                    <Text style={styles.extraFormPrice}>{priceTL(portion.price_cents)}</Text>
                  </View>
                  <Pressable style={styles.extraRemoveBtn} onPress={() => removePortionFromForm(portion.id)}>
                    <Ionicons name="close-circle" size={22} color="#E53935" />
                  </Pressable>
                </View>
              ))}

              <View style={styles.extraAddRow}>
                <TextInput
                  style={[styles.input, styles.extraAddInput]}
                  value={newPortionLabel}
                  onChangeText={setNewPortionLabel}
                  placeholder="Porsiyon adı (ör: 1 Kişilik)"
                  placeholderTextColor="#A3ACA5"
                />
                <TextInput
                  style={[styles.input, styles.extraAddPrice]}
                  value={newPortionPrice}
                  onChangeText={setNewPortionPrice}
                  placeholder="₺"
                  placeholderTextColor="#A3ACA5"
                  keyboardType="decimal-pad"
                />
                <Pressable style={styles.extraAddBtn} onPress={addPortionToForm}>
                  <Ionicons name="add-circle" size={28} color={colors.primary} />
                </Pressable>
              </View>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF8F2' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E3E6DE',
  },
  headerTitle: { fontSize: 24, color: '#151A16', fontFamily: fonts.display },
  headerSub: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', marginTop: 2 },
  calendarBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary + '40',
    backgroundColor: '#FFF4F1',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  addBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addBtnText: { color: '#fff', fontSize: 13, fontFamily: fonts.bold },

  list: { padding: 16, paddingBottom: 40, gap: 10 },

  itemImage: {
    width: '100%',
    height: 140,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    resizeMode: 'cover',
  },
  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    overflow: 'hidden',
  },
  itemCardInactive: { opacity: 0.6 },
  itemMain: { marginBottom: 10, paddingHorizontal: 14, paddingTop: 14 },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  itemTitle: { fontSize: 15, fontFamily: fonts.bold, color: '#151A16', flex: 1 },
  itemTitleInactive: { color: '#6B766F' },
  inactiveBadge: {
    backgroundColor: '#F5F5F5',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  inactiveBadgeText: { fontSize: 10, fontFamily: fonts.bold, color: '#9E9E9E' },
  itemDesc: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', lineHeight: 17, marginBottom: 6 },
  priceStockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemPrice: { fontSize: 15, fontFamily: fonts.extrabold, color: colors.primary },
  stockBadge: { backgroundColor: '#E8F5E9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  stockBadgeOut: { backgroundColor: '#FFEBEE' },
  stockBadgeLow: { backgroundColor: '#FFF8E1' },
  stockBadgeText: { fontSize: 11, fontFamily: fonts.bold, color: '#2E7D32' },
  stockBadgeTextOut: { color: '#C62828' },
  stockBadgeTextLow: { color: '#F57F17' },

  catFilterRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  catPill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E3E6DE' },
  catPillActive: { backgroundColor: '#17402F', borderColor: '#151A16' },
  catPillText: { fontSize: 12, fontFamily: fonts.semibold, color: '#6B766F' },
  catPillTextActive: { color: '#fff' },
  catBadge: { alignSelf: 'flex-start', backgroundColor: '#F3F5EE', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginBottom: 4 },
  catBadgeText: { fontSize: 10, fontFamily: fonts.bold, color: '#56605A' },

  catPickerRow: { gap: 8, paddingVertical: 4 },
  catPickerPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: '#E3E6DE', backgroundColor: '#FAFAFA' },
  catPickerPillActive: { borderColor: colors.primary, backgroundColor: '#FFF4F1' },
  catPickerIcon: { fontFamily: fonts.regular, fontSize: 16 },
  catPickerText: { fontSize: 13, fontFamily: fonts.semibold, color: '#56605A' },
  catPickerTextActive: { color: colors.primary },

  itemActions: { borderTopWidth: 1, borderTopColor: '#EFF2EA', paddingTop: 10, paddingHorizontal: 14, paddingBottom: 14, gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { fontSize: 12, fontFamily: fonts.semibold, color: '#6B766F' },
  actionBtns: { flexDirection: 'row', gap: 8 },
  editBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  editBtnText: { fontSize: 12, fontFamily: fonts.bold, color: '#151A16' },
  deleteBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#FFCDD2',
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
    backgroundColor: '#FFF5F5',
  },
  deleteBtnText: { fontSize: 12, fontFamily: fonts.bold, color: '#E53935' },

  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyEmoji: { fontFamily: fonts.regular, fontSize: 52 },
  emptyTitle: { fontSize: 16, fontFamily: fonts.bold, color: '#151A16' },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: '#6B766F', textAlign: 'center' },

  // Modal
  modal: { flex: 1, backgroundColor: '#FAF8F2' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E3E6DE',
  },
  modalTitle: { fontSize: 15, fontFamily: fonts.extrabold, color: '#151A16' },
  modalCancel: { fontSize: 15, color: '#6B766F', fontFamily: fonts.semibold },
  modalSave: { fontSize: 15, color: colors.primary, fontFamily: fonts.bold },
  modalScroll: { padding: 20, paddingBottom: 40 },
  imageUploadSection: { alignItems: 'center', marginBottom: 20 },
  imageUploadHint: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', marginTop: 8 },

  label: { fontSize: 13, fontFamily: fonts.bold, color: '#151A16', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.regular, fontSize: 15,
    color: '#151A16',
  },
  inputMulti: { height: 88, paddingTop: 12 },

  // Daily limit & schedule
  extraInfoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  dailyLimitBadge: {
    backgroundColor: '#EDE7F6',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dailyLimitText: { fontSize: 10, fontFamily: fonts.semibold, color: '#5E35B1' },
  scheduleBadge: {
    backgroundColor: '#E3F2FD',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  scheduleText: { fontSize: 10, fontFamily: fonts.semibold, color: '#1565C0' },

  // Extras on item card
  extrasRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' },
  extrasLabel: { fontSize: 11, fontFamily: fonts.bold, color: '#56605A', marginRight: 2 },
  extraBadge: { backgroundColor: '#FFF3E0', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  extraBadgeText: { fontSize: 10, fontFamily: fonts.semibold, color: '#E65100' },

  // Extras in form modal
  extrasHint: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', marginBottom: 10, lineHeight: 17 },
  extraFormRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  extraFormInfo: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', marginRight: 10 },
  extraFormLabel: { fontSize: 14, fontFamily: fonts.semibold, color: '#151A16' },
  extraFormPrice: { fontSize: 14, fontFamily: fonts.bold, color: colors.primary },
  extraRemoveBtn: { padding: 2 },
  extraAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  extraAddInput: { flex: 1 },
  extraAddPrice: { width: 70 },
  extraAddBtn: { padding: 4 },

  // Portions on item card (blue badges)
  portionBadge: { backgroundColor: '#E3F2FD', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  portionBadgeText: { fontSize: 10, fontFamily: fonts.semibold, color: '#1565C0' },
});
