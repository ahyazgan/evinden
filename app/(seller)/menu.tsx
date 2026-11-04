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
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import ImageUploadBox from '@/components/shared/ImageUploadBox';
import { TopBar, TopIconButton } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
import { useResponsive } from '@/lib/responsive';
import { ALLERGENS, toggleAllergen } from '@/lib/allergens';
import { DIETARY, toggleKey } from '@/lib/dietary';
import { useTheme } from '@/lib/theme-context';

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

type Category = { id: string; label: string; icon: keyof typeof Ionicons.glyphMap };

const CATEGORIES: Category[] = [
  { id: 'corba', label: 'Çorbalar', icon: 'cafe-outline' },
  { id: 'ana', label: 'Ana Yemekler', icon: 'restaurant-outline' },
  { id: 'salata', label: 'Salatalar', icon: 'leaf-outline' },
  { id: 'tatli', label: 'Tatlılar', icon: 'ice-cream-outline' },
  { id: 'icecek', label: 'İçecekler', icon: 'water-outline' },
  { id: 'diger', label: 'Diğer', icon: 'cube-outline' },
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
  allergens: string[] | null;
  dietary: string[];
  image_url: string | null;
  scheduleDays: number[]; // 0-6, empty = every day
  extras: ExtraItem[];
  portions: PortionItem[];
};

type FormState = { title: string; description: string; priceStr: string; stockStr: string; category: string; image_url: string | null; allergens: string[] | null; dietary: string[] };
const EMPTY_FORM: FormState = { title: '', description: '', priceStr: '', stockStr: '', category: 'ana', image_url: null, allergens: null, dietary: [] };

export default function SellerMenuScreen() {
  const { colors: t } = useTheme();
  const { isDesktop } = useResponsive();
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
                allergens: row.allergens ?? null,
                dietary: row.dietary ?? [],
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
      allergens: item.allergens,
      dietary: item.dietary,
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
    if (form.allergens === null) {
      Alert.alert('Alerjen bilgisi gerekli', 'İçerdiği alerjenleri seç ya da "Alerjen içermiyor" de.');
      return;
    }
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
            allergens: form.allergens,
            dietary: form.dietary,
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
              ? { ...i, allergens: form.allergens, dietary: form.dietary, title, description: form.description.trim(), price_cents: priceCents, stock, dailyLimit: stock === -1 ? 0 : stock, category: form.category, image_url: form.image_url, extras: finalExtras, portions: finalPortions }
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
              allergens: form.allergens,
              dietary: form.dietary,
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
          notifyMyFollowers('Yeni Yemek Eklendi!', `${title} menüye eklendi. Şimdi sipariş ver!`).catch(() => {});
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
          allergens: form.allergens,
          dietary: form.dietary,
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
      <View style={[styles.safe, { backgroundColor: t.background }]}>
        <TopBar title="Menüm" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={t.primary} />
          <Text style={[styles.loadingText, { color: t.textSecondary }]}>Menü yükleniyor...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      <TopBar
        title="Menüm"
        subtitle={`${activeCount} aktif · ${items.length} toplam`}
        right={
          <>
            <TopIconButton icon="calendar-outline" label="Haftalık menü" onPress={() => router.push('/(seller)/weekly-menu')} />
            <Pressable
              style={[styles.topBtn, { backgroundColor: isDesktop ? t.primary : t.panel }]}
              onPress={openAdd}
              accessibilityRole="button"
              accessibilityLabel="Ürün ekle"
            >
              <Ionicons name="add" size={18} color={t.onBrand} />
              <Text style={[styles.topBtnText, { color: t.onBrand }]}>Ekle</Text>
            </Pressable>
          </>
        }
      />

      {/* Category filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catFilterRow} style={styles.noGrow}>
        <Pressable
          style={[styles.chip, { backgroundColor: filterCat === 'all' ? t.brand : t.surface }]}
          hitSlop={2}
          onPress={() => setFilterCat('all')}
          accessibilityRole="tab"
          accessibilityState={{ selected: filterCat === 'all' }}
        >
          <Text style={[styles.chipText, { color: filterCat === 'all' ? t.onBrand : t.text }]}>Tümü</Text>
        </Pressable>
        {CATEGORIES.map(cat => {
          const on = filterCat === cat.id;
          return (
            <Pressable
              key={cat.id}
              style={[styles.chip, { backgroundColor: on ? t.brand : t.surface }]}
              hitSlop={2}
              onPress={() => setFilterCat(cat.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Ionicons name={cat.icon} size={16} color={on ? t.onBrand : t.text} />
              <Text style={[styles.chipText, { color: on ? t.onBrand : t.text }]}>{cat.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {filteredItems.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="restaurant-outline" size={44} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.heading }]}>Menü boş</Text>
            <Text style={[styles.emptySub, { color: t.textSecondary }]}>İlk ürününü ekleyerek başla.</Text>
            <View style={styles.emptyBtn}>
              <Button label="Ürün ekle" onPress={openAdd} />
            </View>
          </View>
        ) : (
          filteredItems.map(item => {
            const category = getCatLabel(item.category);
            const remaining = item.stock - item.soldToday;
            const soldOut = item.stock !== -1 && remaining <= 0;
            const low = item.stock !== -1 && remaining > 0 && remaining <= 5;
            return (
              <View key={item.id} style={[styles.itemCard, { backgroundColor: t.surface }]}>
                <View style={!item.is_available ? styles.itemDimmed : undefined}>
                  {item.image_url ? (
                    <Image source={{ uri: item.image_url }} style={styles.itemImage} />
                  ) : null}
                  <View style={styles.itemMain}>
                    <View style={styles.itemTop}>
                      <Text style={[styles.itemTitle, { color: t.text }]}>{item.title}</Text>
                      {!item.is_available ? (
                        <View style={[styles.tag, { backgroundColor: t.background }]}>
                          <Text style={[styles.tagText, { color: t.text }]}>Pasif</Text>
                        </View>
                      ) : null}
                    </View>
                    {category ? (
                      <View style={[styles.tag, styles.tagIcon, { backgroundColor: t.background }]}>
                        <Ionicons name={category.icon} size={12} color={t.textSecondary} />
                        <Text style={[styles.tagText, { color: t.textSecondary }]}>{category.label}</Text>
                      </View>
                    ) : null}
                    {item.allergens === null ? (
                      <View style={[styles.tag, styles.tagIcon, { backgroundColor: t.background }]}>
                        <Ionicons name="alert-circle-outline" size={12} color={t.danger} />
                        <Text style={[styles.tagText, { color: t.danger }]}>Alerjen bilgisi eksik</Text>
                      </View>
                    ) : null}
                    {item.description ? (
                      <Text style={[styles.itemDesc, { color: t.textSecondary }]} numberOfLines={2}>{item.description}</Text>
                    ) : null}
                    <View style={styles.priceStockRow}>
                      <Text style={[styles.itemPrice, { color: t.text }]}>{priceTL(item.price_cents)}</Text>
                      <View style={[styles.tag, { backgroundColor: t.background }]}>
                        <Text style={[styles.tagText, { color: soldOut ? t.danger : low ? t.text : t.textSecondary }]}>
                          {item.stock === -1 ? 'Sınırsız' : soldOut ? 'Bugünlük bitti' : `${remaining}/${item.stock} kaldı`}
                        </Text>
                      </View>
                    </View>
                    {/* Daily limit & schedule info */}
                    {item.dailyLimit > 0 || item.scheduleDays.length > 0 ? (
                      <View style={styles.extraInfoRow}>
                        {item.dailyLimit > 0 && (
                          <View style={[styles.tag, styles.tagIcon, { backgroundColor: t.background }]}>
                            <Ionicons name="stats-chart-outline" size={12} color={t.text} />
                            <Text style={[styles.tagText, { color: t.text }]}>{item.soldToday}/{item.dailyLimit} günlük</Text>
                          </View>
                        )}
                        {item.scheduleDays.length > 0 && (
                          <View style={[styles.tag, styles.tagIcon, { backgroundColor: t.background }]}>
                            <Ionicons name="calendar-outline" size={12} color={t.text} />
                            <Text style={[styles.tagText, { color: t.text }]}>
                              {item.scheduleDays.map(d => ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'][d]).join(', ')}
                            </Text>
                          </View>
                        )}
                      </View>
                    ) : null}
                    {item.extras.length > 0 && (
                      <View style={styles.extrasRow}>
                        <Text style={[styles.extrasLabel, { color: t.textSecondary }]}>Ekstralar:</Text>
                        {item.extras.map(ex => (
                          <View key={ex.id} style={[styles.tag, { backgroundColor: t.background }]}>
                            <Text style={[styles.tagText, { color: t.text }]}>{ex.label} +₺{(ex.price_cents / 100).toFixed(0)}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {item.portions.length > 0 && (
                      <View style={styles.extrasRow}>
                        <Text style={[styles.extrasLabel, { color: t.textSecondary }]}>Porsiyonlar:</Text>
                        {item.portions.map(p => (
                          <View key={p.id} style={[styles.tag, { backgroundColor: t.background }]}>
                            <Text style={[styles.tagText, { color: t.text }]}>{p.label} ₺{(p.price_cents / 100).toFixed(0)}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </View>

                <View style={[styles.itemActions, { borderTopColor: t.divider }]}>
                  <View style={styles.switchRow}>
                    <Text style={[styles.switchLabel, { color: t.textSecondary }]}>{item.is_available ? 'Aktif' : 'Pasif'}</Text>
                    <Switch
                      value={item.is_available}
                      onValueChange={() => toggleAvailability(item.id)}
                      trackColor={{ true: t.primary, false: t.divider }}
                      thumbColor={t.onBrand}
                      {...({ activeThumbColor: t.onBrand } as object)}
                      accessibilityLabel={`${item.title}: satışta`}
                    />
                  </View>
                  <View style={styles.actionBtns}>
                    <View style={styles.flex}>
                      <Button label="Düzenle" variant="outline" fullWidth onPress={() => openEdit(item)} />
                    </View>
                    <View style={styles.flex}>
                      <Button label="Sil" variant="danger" fullWidth onPress={() => deleteItem(item)} />
                    </View>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Add/Edit Modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeModal}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top', 'bottom']}>
            <View style={[styles.modalHeader, { borderBottomColor: t.divider }]}>
              <Pressable style={styles.modalCancelBtn} onPress={closeModal} accessibilityRole="button">
                <Text style={[styles.modalCancel, { color: t.textSecondary }]}>İptal</Text>
              </Pressable>
              <Text style={[styles.modalTitle, { color: t.heading }]} accessibilityRole="header">{editId ? 'Ürünü düzenle' : 'Yeni ürün'}</Text>
              <Button label="Kaydet" size="sm" loading={saving} onPress={saveItem} />
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.imageUploadSection}>
                <ImageUploadBox
                  imageUrl={form.image_url}
                  fallbackBg={t.surface}
                  bucket="food-images"
                  path={`menu/${sellerId ?? 'local'}/${editId ?? `new-${Date.now()}`}`}
                  aspect={[4, 3]}
                  size={100}
                  borderRadius={16}
                  onUploaded={(url) => setForm(f => ({ ...f, image_url: url }))}
                />
                <Text style={[styles.hint, { color: t.textSecondary }]}>Ürün fotoğrafı ekle</Text>
              </View>

              <Input
                label="Ürün adı *"
                value={form.title}
                onChangeText={v => setForm(f => ({ ...f, title: v }))}
                placeholder="Örn: Mercimek Çorbası"
              />

              <Text style={[styles.label, styles.fieldGap, { color: t.text }]}>Kategori</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catPickerRow}>
                {CATEGORIES.map(cat => {
                  const on = form.category === cat.id;
                  return (
                    <Pressable
                      key={cat.id}
                      style={[styles.chip, { backgroundColor: on ? t.brand : t.surface }]}
                      hitSlop={2}
                      onPress={() => setForm(f => ({ ...f, category: cat.id }))}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                    >
                      <Ionicons name={cat.icon} size={16} color={on ? t.onBrand : t.text} />
                      <Text style={[styles.chipText, { color: on ? t.onBrand : t.text }]}>{cat.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text style={[styles.label, styles.fieldGap, { color: t.text }]}>Alerjenler</Text>
              <Text style={[styles.allergenHint, { color: t.textSecondary }]}>Müşteri bunu görür, doğru işaretle.</Text>
              <View style={styles.allergenWrap}>
                <Pressable
                  style={[styles.chip, { backgroundColor: form.allergens?.length === 0 ? t.brand : t.surface }]}
                  hitSlop={2}
                  onPress={() => setForm(f => ({ ...f, allergens: f.allergens?.length === 0 ? null : [] }))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: form.allergens?.length === 0 }}
                >
                  <Text style={[styles.chipText, { color: form.allergens?.length === 0 ? t.onBrand : t.text }]}>Alerjen içermiyor</Text>
                </Pressable>
                {ALLERGENS.map(a => {
                  const on = !!form.allergens?.includes(a.key);
                  return (
                    <Pressable
                      key={a.key}
                      style={[styles.chip, { backgroundColor: on ? t.brand : t.surface }]}
                      hitSlop={2}
                      onPress={() => setForm(f => {
                        const next = toggleAllergen(f.allergens, a.key);
                        return { ...f, allergens: next.length === 0 ? null : next };
                      })}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      <Text style={[styles.chipText, { color: on ? t.onBrand : t.text }]}>{a.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.label, styles.fieldGap, { color: t.text }]}>Özellikler</Text>
              <Text style={[styles.allergenHint, { color: t.textSecondary }]}>Uyanları seç, müşteri bunlarla filtreler.</Text>
              <View style={styles.allergenWrap}>
                {DIETARY.map(d => {
                  const on = form.dietary.includes(d.key);
                  return (
                    <Pressable
                      key={d.key}
                      style={[styles.chip, { backgroundColor: on ? t.brand : t.surface }]}
                      hitSlop={2}
                      onPress={() => setForm(f => ({ ...f, dietary: toggleKey(f.dietary, d.key) }))}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      <Text style={[styles.chipText, { color: on ? t.onBrand : t.text }]}>{d.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.fieldGap}>
                <Input
                  label="Açıklama"
                  style={styles.inputMulti}
                  value={form.description}
                  onChangeText={v => setForm(f => ({ ...f, description: v }))}
                  placeholder="Ürün hakkında kısa bilgi..."
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>

              <View style={styles.fieldGap}>
                <Input
                  label="Fiyat (₺) *"
                  value={form.priceStr}
                  onChangeText={v => setForm(f => ({ ...f, priceStr: v }))}
                  placeholder="45,00"
                  keyboardType="decimal-pad"
                />
              </View>

              <View style={styles.fieldGap}>
                <Input
                  label="Günlük adet"
                  value={form.stockStr}
                  onChangeText={v => setForm(f => ({ ...f, stockStr: v }))}
                  placeholder="Boş bırakırsan sınırsız"
                  keyboardType="number-pad"
                />
              </View>

              {/* Extras Section */}
              <Text style={[styles.label, styles.sectionGap, { color: t.text }]}>Ekstra seçenekler</Text>
              <Text style={[styles.extrasHint, { color: t.textSecondary }]}>Müşterinin sipariş sırasında ekleyebileceği seçenekler (ekstra peynir, sos gibi)</Text>

              {formExtras.map(extra => (
                <View key={extra.id} style={[styles.extraFormRow, { backgroundColor: t.surface }]}>
                  <View style={styles.extraFormInfo}>
                    <Text style={[styles.extraFormLabel, { color: t.text }]}>{extra.label}</Text>
                    <Text style={[styles.extraFormPrice, { color: t.text }]}>+₺{(extra.price_cents / 100).toFixed(2).replace('.', ',')}</Text>
                  </View>
                  <Pressable
                    style={styles.extraRemoveBtn}
                    onPress={() => removeExtraFromForm(extra.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${extra.label} ekstrasını kaldır`}
                  >
                    <Ionicons name="close-circle" size={22} color={t.danger} />
                  </Pressable>
                </View>
              ))}

              <View style={styles.extraAddRow}>
                <View style={styles.flex}>
                  <Input
                    value={newExtraLabel}
                    onChangeText={setNewExtraLabel}
                    placeholder="Ekstra adı (ör: Ekstra Peynir)"
                    accessibilityLabel="Ekstra adı"
                  />
                </View>
                <View style={styles.extraAddPrice}>
                  <Input
                    value={newExtraPrice}
                    onChangeText={setNewExtraPrice}
                    placeholder="₺"
                    keyboardType="decimal-pad"
                    accessibilityLabel="Ekstra fiyatı"
                  />
                </View>
                <Pressable
                  style={[styles.extraAddBtn, { backgroundColor: t.primary }]}
                  onPress={addExtraToForm}
                  accessibilityRole="button"
                  accessibilityLabel="Ekstra ekle"
                >
                  <Ionicons name="add" size={22} color={t.onBrand} />
                </Pressable>
              </View>

              {/* Portions Section */}
              <Text style={[styles.label, styles.sectionGap, { color: t.text }]}>Porsiyon seçenekleri</Text>
              <Text style={[styles.extrasHint, { color: t.textSecondary }]}>Farklı porsiyon boyutları ekle (1 kişilik, 2 kişilik, aile boyu)</Text>

              {formPortions.map(portion => (
                <View key={portion.id} style={[styles.extraFormRow, { backgroundColor: t.surface }]}>
                  <View style={styles.extraFormInfo}>
                    <Text style={[styles.extraFormLabel, { color: t.text }]}>{portion.label}</Text>
                    <Text style={[styles.extraFormPrice, { color: t.text }]}>{priceTL(portion.price_cents)}</Text>
                  </View>
                  <Pressable
                    style={styles.extraRemoveBtn}
                    onPress={() => removePortionFromForm(portion.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${portion.label} porsiyonunu kaldır`}
                  >
                    <Ionicons name="close-circle" size={22} color={t.danger} />
                  </Pressable>
                </View>
              ))}

              <View style={styles.extraAddRow}>
                <View style={styles.flex}>
                  <Input
                    value={newPortionLabel}
                    onChangeText={setNewPortionLabel}
                    placeholder="Porsiyon adı (ör: 1 Kişilik)"
                    accessibilityLabel="Porsiyon adı"
                  />
                </View>
                <View style={styles.extraAddPrice}>
                  <Input
                    value={newPortionPrice}
                    onChangeText={setNewPortionPrice}
                    placeholder="₺"
                    keyboardType="decimal-pad"
                    accessibilityLabel="Porsiyon fiyatı"
                  />
                </View>
                <Pressable
                  style={[styles.extraAddBtn, { backgroundColor: t.primary }]}
                  onPress={addPortionToForm}
                  accessibilityRole="button"
                  accessibilityLabel="Porsiyon ekle"
                >
                  <Ionicons name="add" size={22} color={t.onBrand} />
                </Pressable>
              </View>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  allergenHint: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular, marginTop: -2, marginBottom: 8 },
  allergenWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  safe: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  noGrow: { flexGrow: 0 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontFamily: fonts.regular, fontSize: 13 },

  topBtn: { height: 44, paddingHorizontal: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  topBtnText: { fontSize: 14, fontFamily: fonts.bold },

  catFilterRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  chipText: { fontSize: 13, fontFamily: fonts.bold },

  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },

  itemCard: { borderRadius: 16, overflow: 'hidden' },
  itemDimmed: { opacity: 0.6 },
  itemImage: { width: '100%', height: 140, resizeMode: 'cover' },
  itemMain: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  itemTitle: { flex: 1, fontSize: 15, fontFamily: fonts.bold },
  itemDesc: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, marginBottom: 6, marginTop: 4 },
  priceStockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  itemPrice: { fontSize: 15, fontFamily: fonts.extrabold },

  tag: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  tagIcon: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tagText: { fontSize: 11, fontFamily: fonts.semibold },
  extraInfoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  extrasRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' },
  extrasLabel: { fontSize: 12, fontFamily: fonts.bold, marginRight: 2 },

  itemActions: { borderTopWidth: 1, paddingTop: 8, paddingHorizontal: 14, paddingBottom: 14, gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  switchLabel: { fontSize: 13, fontFamily: fonts.semibold },
  actionBtns: { flexDirection: 'row', gap: 8 },

  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.display },
  emptySub: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, textAlign: 'center' },
  emptyBtn: { marginTop: 8 },

  // Modal
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  modalCancelBtn: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  modalCancel: { fontSize: 15, fontFamily: fonts.semibold },
  modalTitle: { flexShrink: 1, fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.3 },
  modalScroll: { padding: 16, paddingBottom: 40 },
  imageUploadSection: { alignItems: 'center', marginBottom: 20 },
  hint: { fontSize: 12, fontFamily: fonts.regular, marginTop: 8 },

  label: { fontSize: 13, fontFamily: fonts.semibold, marginBottom: 5 },
  fieldGap: { marginTop: 14 },
  sectionGap: { marginTop: 22 },
  catPickerRow: { gap: 8, paddingVertical: 2 },
  inputMulti: { minHeight: 76, paddingVertical: 10 },

  extrasHint: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, marginBottom: 10 },
  extraFormRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingLeft: 14, minHeight: 48, marginBottom: 8 },
  extraFormInfo: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  extraFormLabel: { flexShrink: 1, fontSize: 14, fontFamily: fonts.semibold },
  extraFormPrice: { fontSize: 14, fontFamily: fonts.bold },
  extraRemoveBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  extraAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  extraAddPrice: { width: 76 },
  extraAddBtn: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
