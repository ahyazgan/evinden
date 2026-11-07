import { useEffect, useRef, useState } from 'react';
import {
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
import { OptionGroupsEditor } from '@/components/shared/OptionGroupsEditor';
import { ChoiceListEditor } from '@/components/shared/ChoiceListEditor';
import { MenuSectionsEditor } from '@/components/shared/MenuSectionsEditor';
import { TopBar, TopIconButton } from '@/components/shared/TopBar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  fetchSellerByUserId,
  fetchMenuItems,
  fetchMenuSections,
  createMenuItem,
  updateMenuItem,
  setMenuItemDailyLimit,
  deleteMenuItem as dbDeleteMenuItem,
  fetchExtras,
  fetchOptionGroups,
  fetchPortions,
  fetchVariants,
  reorderMenuItems,
  saveMenuItemChoices,
  saveOptionGroups,
  notifyMyFollowers,
  type MenuSection,
} from '@/lib/db';
import { choiceFromRow, choicesToPayload, choicesUnchanged, moveItem, type ChoiceDraft, type ChoiceKind, type ChoicePayloadRow } from '@/lib/menu-choices';
import { groupMenu } from '@/lib/menu-sections';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '@/lib/fonts';
import { istanbulToday } from '@/lib/date';
import { useResponsive } from '@/lib/responsive';
import { ALLERGENS, toggleAllergen } from '@/lib/allergens';
import { DIETARY, toggleKey } from '@/lib/dietary';
import { formToPayload, groupRuleLabel, groupsFromRows, groupsToForm, type FormGroup, type OptionGroup } from '@/lib/option-groups';
import { categoryLabel, isUnknownCategory, MENU_CATEGORIES, menuCategoryKey, type MenuCategoryKey } from '@/lib/menu-categories';
import { useTheme } from '@/lib/theme-context';
import { LogoLoader } from '@/components/shared/Logo';

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

type Category = { id: MenuCategoryKey; label: string; icon: keyof typeof Ionicons.glyphMap };

const CATEGORY_ICONS: Record<MenuCategoryKey, keyof typeof Ionicons.glyphMap> = {
  corba: 'cafe-outline',
  ana: 'restaurant-outline',
  izgara: 'flame-outline',
  kahvalti: 'sunny-outline',
  salata: 'leaf-outline',
  tatli: 'ice-cream-outline',
  pasta: 'gift-outline',
  borek: 'layers-outline',
  zeytinyagli: 'nutrition-outline',
  hamur: 'pizza-outline',
  icecek: 'water-outline',
  diger: 'cube-outline',
};

const CATEGORIES: Category[] = MENU_CATEGORIES.map(c => ({ id: c.id, label: c.label, icon: CATEGORY_ICONS[c.id] }));

type Choices = { extras: ChoiceDraft[]; portions: ChoiceDraft[]; variants: ChoiceDraft[] };
const CHOICE_KINDS: { kind: ChoiceKind; field: keyof Choices }[] = [
  { kind: 'variant', field: 'variants' },
  { kind: 'portion', field: 'portions' },
  { kind: 'extra', field: 'extras' },
];
const EMPTY_CHOICES: Choices = { extras: [], portions: [], variants: [] };

/** Ürünün ekstra, porsiyon ve çeşitlerini sunucudaki sırasıyla okur. */
async function loadChoices(itemId: string): Promise<Choices> {
  const [extras, portions, variants] = await Promise.all([fetchExtras(itemId), fetchPortions(itemId), fetchVariants(itemId)]);
  return { extras: extras.map(choiceFromRow), portions: portions.map(choiceFromRow), variants: variants.map(choiceFromRow) };
}

type MenuItem = {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  is_available: boolean;
  stock: number; // -1 = unlimited
  dailyLimit: number; // 0 = unlimited, >0 = max per day
  soldToday: number;
  /** Filtre ve simge için anahtar */
  category: string;
  /** Veritabanındaki hali: satıcı kategoriyi değiştirmedikçe aynen geri yazılır. */
  storedCategory: string | null;
  allergens: string[] | null;
  dietary: string[];
  image_url: string | null;
  extras: ChoiceDraft[];
  portions: ChoiceDraft[];
  variants: ChoiceDraft[];
  optionGroups: OptionGroup[];
  /** Restoranın kendi bölümü ve sıra (057) */
  sectionId: string | null;
  sortOrder: number;
  createdAt: string;
};

type FormState = { title: string; description: string; priceStr: string; stockStr: string; category: string; image_url: string | null; allergens: string[] | null; dietary: string[]; sectionId: string | null };
const EMPTY_FORM: FormState = { title: '', description: '', priceStr: '', stockStr: '', category: 'ana', image_url: null, allergens: null, dietary: [], sectionId: null };

/** Listede gruplama için: bölüm varsa bölüm, yoksa kategori adı. */
function groupable(item: MenuItem) {
  return { item, section_id: item.sectionId, sort_order: item.sortOrder, created_at: item.createdAt, category: categoryLabel(item.storedCategory) };
}

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
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [formChoices, setFormChoices] = useState<Choices>(EMPTY_CHOICES);
  const [formGroups, setFormGroups] = useState<FormGroup[]>([]);
  const [sections, setSections] = useState<MenuSection[]>([]);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  const reorderBusy = useRef(false);

  // Load seller + menu from Supabase, fallback to demo
  useEffect(() => {
    if (!profile?.id) { setLoading(false); setItems([]); return; }
    (async () => {
      setLoadFailed(false);
      setLoading(true);
      try {
        const seller = await fetchSellerByUserId(profile.id);
        if (seller) {
          setSellerId(seller.id);
          const [dbItems, dbSections] = await Promise.all([fetchMenuItems(seller.id), fetchMenuSections(seller.id)]);
          setSections(dbSections);
          if (dbItems.length > 0) {
            const groupRows = await fetchOptionGroups(dbItems.map(row => row.id));
            const itemsWithExtras = await Promise.all(dbItems.map(async (row) => {
              const { extras, portions, variants } = await loadChoices(row.id);
              return {
                id: row.id,
                title: row.title,
                description: row.description ?? '',
                price_cents: row.price_cents,
                is_available: row.is_available,
                stock: (row.daily_limit ?? 0) > 0 ? row.daily_limit! : -1,
                dailyLimit: row.daily_limit ?? 0,
                soldToday: row.stock_reset_date === istanbulToday() ? row.sold_today ?? 0 : 0,
                category: menuCategoryKey(row.category),
                storedCategory: row.category ?? null,
                image_url: row.image_url,
                allergens: row.allergens ?? null,
                dietary: row.dietary ?? [],
                extras,
                portions,
                variants,
                optionGroups: groupsFromRows(groupRows.get(row.id)),
                sectionId: row.section_id ?? null,
                sortOrder: row.sort_order ?? 0,
                createdAt: row.created_at,
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
        // "Menü boş" denirse satıcı ürünlerini silinmiş sanır.
        setItems([]);
        setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [profile, reloadKey]);

  const openAdd = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setFormChoices(EMPTY_CHOICES);
    setFormGroups([]);
    setModalVisible(true);
  };

  const openEdit = (item: MenuItem) => {
    setEditId(item.id);
    setForm({
      title: item.title,
      description: item.description,
      priceStr: (item.price_cents / 100).toFixed(2).replace('.', ','),
      stockStr: item.stock === -1 ? '' : String(item.stock),
      category: item.storedCategory ?? '',
      image_url: item.image_url,
      allergens: item.allergens,
      dietary: item.dietary,
      sectionId: item.sectionId,
    });
    setFormChoices({ extras: item.extras, portions: item.portions, variants: item.variants });
    setFormGroups(groupsToForm(item.optionGroups));
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditId(null);
    setForm(EMPTY_FORM);
    setFormChoices(EMPTY_CHOICES);
    setFormGroups([]);
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

    const groupsResult = formToPayload(formGroups);
    if ('error' in groupsResult) {
      Alert.alert('Seçim grubunu kontrol et', groupsResult.error);
      return;
    }
    // Ekstra, porsiyon ve çeşitler kayıttan önce doğrulanır: hatalıysa ürün de yazılmaz.
    const choicePayloads = {} as Record<ChoiceKind, ChoicePayloadRow[]>;
    for (const { kind, field } of CHOICE_KINDS) {
      const result = choicesToPayload(kind, formChoices[field]);
      if ('error' in result) { Alert.alert('Seçenekleri kontrol et', result.error); return; }
      choicePayloads[kind] = result.rows;
    }

    /** Grupları yazar, güncel halini döner; yazılamazsa eski hali kalır ve satıcıya söylenir. */
    const syncGroups = async (itemId: string, previous: OptionGroup[]): Promise<OptionGroup[]> => {
      if (groupsResult.groups.length === 0 && previous.length === 0) return previous;
      try {
        await saveOptionGroups(itemId, groupsResult.groups);
        return groupsFromRows((await fetchOptionGroups([itemId])).get(itemId));
      } catch (e: any) {
        failed.push(`Seçim grupları kaydedilemedi: ${e?.message ?? 'bağlantı hatası'}`);
        return previous;
      }
    };

    /** Değişen seçenek türlerini yazar, sunucudaki güncel halini döner. Yazılamayan tür eski haliyle kalır. */
    const syncChoices = async (itemId: string, previous: Choices): Promise<Choices> => {
      let wrote = false;
      for (const { kind, field } of CHOICE_KINDS) {
        if (choicesUnchanged(kind, previous[field], formChoices[field])) continue;
        try {
          await saveMenuItemChoices(itemId, kind, choicePayloads[kind]);
          wrote = true;
        } catch (e: any) {
          failed.push(`${kind === 'extra' ? 'Ekstralar' : kind === 'portion' ? 'Porsiyonlar' : 'Çeşitler'} kaydedilemedi: ${e?.code === '22023' ? e.message : 'bağlantı hatası'}`);
        }
      }
      if (!wrote) return previous;
      try { return await loadChoices(itemId); } catch {
        // Yazıldı ama okunamadı: ekrandaki hâl sunucudan farklı olabilir, menü baştan yüklenir.
        staleChoices = true;
        return previous;
      }
    };
    let staleChoices = false;

    setSaving(true);
    // Ürün kaydedildikten sonra başarısız olan parçalar: tekrar kaydetmek ürünü çoğaltmasın diye form kapanır, satıcıya söylenir.
    const failed: string[] = [];
    try {
      if (editId && sellerId) {
        const existingItem = items.find(i => i.id === editId);
        await setMenuItemDailyLimit(editId, stock === -1 ? 0 : stock);
        await updateMenuItem(editId, {
          title,
          description: form.description.trim() || null,
          price_cents: priceCents,
          category: form.category || null,
          image_url: form.image_url,
          allergens: form.allergens,
          dietary: form.dietary,
          section_id: form.sectionId,
        });
        const finalChoices = await syncChoices(editId, existingItem ?? { ...EMPTY_CHOICES });
        const finalGroups = await syncGroups(editId, existingItem?.optionGroups ?? []);
        setItems(prev =>
          prev.map(i =>
            i.id === editId
              ? {
                ...i, allergens: form.allergens, dietary: form.dietary, title, description: form.description.trim(),
                price_cents: priceCents, stock, dailyLimit: stock === -1 ? 0 : stock, category: menuCategoryKey(form.category),
                storedCategory: form.category || null, image_url: form.image_url, sectionId: form.sectionId,
                extras: finalChoices.extras, portions: finalChoices.portions, variants: finalChoices.variants, optionGroups: finalGroups,
              }
              : i,
          ),
        );
      } else if (sellerId) {
        // Yeni ürün listenin sonuna eklenir.
        const sortOrder = items.reduce((max, i) => Math.max(max, i.sortOrder), -1) + 1;
        const created = await createMenuItem({
          seller_id: sellerId,
          title,
          description: form.description.trim() || null,
          price_cents: priceCents,
          category: form.category || null,
          image_url: form.image_url,
          allergens: form.allergens,
          dietary: form.dietary,
          section_id: form.sectionId,
          sort_order: sortOrder,
        });
        const newId = created.id;
        if (stock !== -1) {
          try { await setMenuItemDailyLimit(newId, stock); } catch { failed.push('Günlük adet kaydedilemedi'); }
        }
        const savedChoices = await syncChoices(newId, { ...EMPTY_CHOICES });
        const savedGroups = await syncGroups(newId, []);
        notifyMyFollowers('Yeni Yemek Eklendi!', `${title} menüye eklendi. Şimdi sipariş ver!`).catch(() => {});
        const limitFailed = failed.includes('Günlük adet kaydedilemedi');
        const newItem: MenuItem = {
          id: newId,
          title,
          description: form.description.trim(),
          price_cents: priceCents,
          is_available: true,
          stock: limitFailed ? -1 : stock,
          dailyLimit: stock === -1 || limitFailed ? 0 : stock,
          soldToday: 0,
          category: menuCategoryKey(form.category),
          storedCategory: form.category || null,
          image_url: form.image_url,
          allergens: form.allergens,
          dietary: form.dietary,
          extras: savedChoices.extras,
          portions: savedChoices.portions,
          variants: savedChoices.variants,
          optionGroups: savedGroups,
          sectionId: form.sectionId,
          sortOrder,
          createdAt: created.created_at,
        };
        setItems(prev => [...prev, newItem]);
      }
      closeModal();
      if (staleChoices) setReloadKey(k => k + 1);
      if (failed.length > 0) {
        Alert.alert('Ürün kaydedildi, bazı seçenekler kaydedilemedi', `${failed.join('\n')}\n\nÜrünü düzenleyip tekrar dene.`);
      }
    } catch (err: any) {
      Alert.alert('Kaydedilemedi', err?.message ?? 'Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Ürünü kendi grubunda (bölüm ya da kategori) bir yukarı/aşağı taşır. Grupların sırası bozulmasın diye
   * bütün menünün yeni sırası yazılır.
   */
  const moveMenuItem = async (itemId: string, delta: -1 | 1) => {
    // Hızlı iki dokunuş aynı anda geçmesin: durum değişkeni bir sonraki çizime kadar güncellenmez.
    if (reordering || reorderBusy.current) return;
    reorderBusy.current = true;
    const groups = groupMenu(items.map(groupable), sections);
    const group = groups.find(g => g.items.some(x => x.item.id === itemId));
    if (!group) { reorderBusy.current = false; return; }
    const index = group.items.findIndex(x => x.item.id === itemId);
    const moved = moveItem(group.items, index, delta);
    if (moved.every((x, i) => x === group.items[i])) { reorderBusy.current = false; return; }
    const ordered = groups.flatMap(g => (g === group ? moved : g.items)).map(x => x.item.id);
    const before = new Map(items.map(i => [i.id, i.sortOrder]));
    const position = new Map(ordered.map((id, i) => [id, i]));
    setItems(prev => prev.map(i => ({ ...i, sortOrder: position.get(i.id) ?? i.sortOrder })));
    setReordering(true);
    try {
      await reorderMenuItems(ordered);
    } catch {
      // Yalnızca sıra geri alınır; bu arada yapılan başka değişiklik (ör. satışa kapatma) korunur.
      setItems(prev => prev.map(i => ({ ...i, sortOrder: before.get(i.id) ?? i.sortOrder })));
      Alert.alert('Sıra kaydedilemedi', 'Lütfen tekrar dene.');
    } finally {
      setReordering(false);
      reorderBusy.current = false;
    }
  };

  const onSectionsSaved = (next: MenuSection[]) => {
    setSections(next);
    // Silinen bölümdeki ürünler sunucuda bölümsüz kaldı.
    const ids = new Set(next.map(s => s.id));
    setItems(prev => prev.map(i => (i.sectionId && !ids.has(i.sectionId) ? { ...i, sectionId: null } : i)));
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
          try {
            if (sellerId) await dbDeleteMenuItem(item.id);
            setItems(prev => prev.filter(i => i.id !== item.id));
          } catch {
            Alert.alert('Silinemedi', `"${item.title}" menüde kalmaya devam ediyor. Lütfen tekrar dene.`);
          }
        },
      },
    ]);
  };

  const activeCount = items.filter(i => i.is_available).length;
  const filteredItems = filterCat === 'all' ? items : items.filter(i => i.category === filterCat);
  const getCatLabel = (id: string) => CATEGORIES.find(c => c.id === id);
  // Düzenlenen yemeğin listede olmayan eski kategorisi: satıcı başka bir şey seçip vazgeçerse geri dönebilsin.
  const editedStored = editId ? items.find(i => i.id === editId)?.storedCategory : null;
  const legacyCategory = isUnknownCategory(editedStored) ? editedStored ?? null : null;
  // Liste müşterinin göreceği sırayla, bölüm (yoksa kategori) başlıklarıyla gösterilir. Sıra yalnızca
  // "Tümü" görünümünde değişir: filtrede grup eksik görünür.
  const listGroups = groupMenu(filteredItems.map(groupable), sections);
  const canReorder = filterCat === 'all' && !loadFailed;
  const sectionTitle = (id: string | null) => sections.find(s => s.id === id)?.title ?? null;
  const sectionCounts = items.reduce<Record<string, number>>((acc, i) => {
    if (i.sectionId) acc[i.sectionId] = (acc[i.sectionId] ?? 0) + 1;
    return acc;
  }, {});

  if (loading) {
    return (
      <View style={[styles.safe, { backgroundColor: t.background }]}>
        <TopBar title="Menüm" />
        <View style={styles.center}>
          <LogoLoader />
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
            <TopIconButton icon="list-outline" label="Menü bölümleri" onPress={() => setSectionsOpen(true)} />
            <TopIconButton icon="calendar-outline" label="Haftalık menü" onPress={() => router.push('/restoran/weekly-menu')} />
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
        {loadFailed ? (
          <View style={styles.empty}>
            <Ionicons name="cloud-offline-outline" size={44} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.heading }]}>Menü yüklenemedi</Text>
            <Text style={[styles.emptySub, { color: t.textSecondary }]}>Ürünlerin silinmedi. Bağlantını kontrol edip tekrar dene.</Text>
            <View style={styles.emptyBtn}>
              <Button label="Tekrar dene" onPress={() => setReloadKey(k => k + 1)} />
            </View>
          </View>
        ) : filteredItems.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="restaurant-outline" size={44} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.heading }]}>Menü boş</Text>
            <Text style={[styles.emptySub, { color: t.textSecondary }]}>İlk ürününü ekleyerek başla.</Text>
            <View style={styles.emptyBtn}>
              <Button label="Ürün ekle" onPress={openAdd} />
            </View>
          </View>
        ) : (
          listGroups.map(group => (
            <View key={group.title} style={styles.group}>
              <Text style={[styles.groupTitle, { color: t.heading }]} accessibilityRole="header">
                {group.title} <Text style={[styles.groupCount, { color: t.textSecondary }]}>· {group.items.length}</Text>
              </Text>
              {group.items.map(({ item }, index) => {
            const category = getCatLabel(item.category);
            const remaining = item.stock - item.soldToday;
            const soldOut = item.stock !== -1 && remaining <= 0;
            const low = item.stock !== -1 && remaining > 0 && remaining <= 5;
            const section = sectionTitle(item.sectionId);
            const choiceRows: { label: string; list: ChoiceDraft[]; prefix: string }[] = [
              { label: 'Çeşitler', list: item.variants, prefix: '+₺' },
              { label: 'Porsiyonlar', list: item.portions, prefix: '₺' },
              { label: 'Ekstralar', list: item.extras, prefix: '+₺' },
            ];
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
                    <View style={styles.extraInfoRow}>
                      {category ? (
                        <View style={[styles.tag, styles.tagIcon, { backgroundColor: t.background }]}>
                          <Ionicons name={category.icon} size={12} color={t.textSecondary} />
                          <Text style={[styles.tagText, { color: t.textSecondary }]}>{categoryLabel(item.storedCategory)}</Text>
                        </View>
                      ) : null}
                      {section && filterCat !== 'all' ? (
                        <View style={[styles.tag, styles.tagIcon, { backgroundColor: t.background }]}>
                          <Ionicons name="list-outline" size={12} color={t.textSecondary} />
                          <Text style={[styles.tagText, { color: t.textSecondary }]}>{section}</Text>
                        </View>
                      ) : null}
                      {item.allergens === null ? (
                        <View style={[styles.tag, styles.tagIcon, { backgroundColor: t.background }]}>
                          <Ionicons name="alert-circle-outline" size={12} color={t.danger} />
                          <Text style={[styles.tagText, { color: t.danger }]}>Alerjen bilgisi eksik</Text>
                        </View>
                      ) : null}
                    </View>
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
                    {item.dailyLimit > 0 ? (
                      <View style={styles.extraInfoRow}>
                        <View style={[styles.tag, styles.tagIcon, { backgroundColor: t.background }]}>
                          <Ionicons name="stats-chart-outline" size={12} color={t.text} />
                          <Text style={[styles.tagText, { color: t.text }]}>{item.soldToday}/{item.dailyLimit} günlük</Text>
                        </View>
                      </View>
                    ) : null}
                    {choiceRows.filter(r => r.list.length > 0).map(r => (
                      <View key={r.label} style={styles.extrasRow}>
                        <Text style={[styles.extrasLabel, { color: t.textSecondary }]}>{r.label}:</Text>
                        {r.list.map(c => (
                          <View key={c.key} style={[styles.tag, { backgroundColor: t.background }]}>
                            <Text style={[styles.tagText, { color: c.isAvailable ? t.text : t.danger }]}>
                              {c.label}{c.priceStr !== '0' || r.prefix === '₺' ? ` ${r.prefix}${c.priceStr}` : ''}{c.isAvailable ? '' : ' (bitti)'}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ))}
                    {item.optionGroups.map(og => (
                      <View key={og.id} style={styles.extrasRow}>
                        <Text style={[styles.extrasLabel, { color: t.textSecondary }]}>{og.title} ({groupRuleLabel(og)}):</Text>
                        {og.options.map(option => (
                          <View key={option.id} style={[styles.tag, { backgroundColor: t.background }]}>
                            <Text style={[styles.tagText, { color: option.isAvailable ? t.text : t.danger }]}>
                              {option.label}{option.priceCents > 0 ? ` +₺${(option.priceCents / 100).toFixed(0)}` : ''}{option.isAvailable ? '' : ' (bitti)'}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                </View>

                <View style={[styles.itemActions, { borderTopColor: t.divider }]}>
                  <View style={styles.switchRow}>
                    <Text style={[styles.switchLabel, { color: t.textSecondary }]}>{item.is_available ? 'Aktif' : 'Pasif'}</Text>
                    {canReorder && group.items.length > 1 ? (
                      <View style={styles.orderBtns}>
                        <Pressable style={styles.orderBtn} disabled={index === 0 || reordering} onPress={() => moveMenuItem(item.id, -1)} accessibilityRole="button" accessibilityLabel={`${item.title}: yukarı taşı`}>
                          <Ionicons name="arrow-up" size={18} color={index === 0 ? t.textMuted : t.text} />
                        </Pressable>
                        <Pressable style={styles.orderBtn} disabled={index === group.items.length - 1 || reordering} onPress={() => moveMenuItem(item.id, 1)} accessibilityRole="button" accessibilityLabel={`${item.title}: aşağı taşı`}>
                          <Ionicons name="arrow-down" size={18} color={index === group.items.length - 1 ? t.textMuted : t.text} />
                        </Pressable>
                      </View>
                    ) : null}
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
              })}
            </View>
          ))
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
                {legacyCategory ? (
                  <Pressable
                    style={[styles.chip, { backgroundColor: form.category === legacyCategory ? t.brand : t.surface }]}
                    hitSlop={2}
                    onPress={() => setForm(f => ({ ...f, category: legacyCategory }))}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: form.category === legacyCategory }}
                  >
                    <Ionicons name="pricetag-outline" size={16} color={form.category === legacyCategory ? t.onBrand : t.text} />
                    <Text style={[styles.chipText, { color: form.category === legacyCategory ? t.onBrand : t.text }]}>{legacyCategory}</Text>
                  </Pressable>
                ) : null}
                {CATEGORIES.map(cat => {
                  const on = !isUnknownCategory(form.category) && menuCategoryKey(form.category) === cat.id;
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

              <Text style={[styles.label, styles.fieldGap, { color: t.text }]}>Menüdeki bölümü</Text>
              {sections.length === 0 ? (
                <Text style={[styles.allergenHint, { color: t.textSecondary }]}>
                  Henüz bölüm açmadın; ürün menüde kategorisinin altında görünür. Bölüm açmak için "Menü bölümleri" düğmesini kullan.
                </Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catPickerRow}>
                  {[{ id: null as string | null, title: 'Bölümsüz' }, ...sections].map(sec => {
                    const on = form.sectionId === sec.id;
                    return (
                      <Pressable
                        key={sec.id ?? 'none'}
                        style={[styles.chip, { backgroundColor: on ? t.brand : t.surface }]}
                        hitSlop={2}
                        onPress={() => setForm(f => ({ ...f, sectionId: sec.id }))}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[styles.chipText, { color: on ? t.onBrand : t.text }]}>{sec.title}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}

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

              <ChoiceListEditor kind="variant" value={formChoices.variants} onChange={v => setFormChoices(c => ({ ...c, variants: v }))} />
              <ChoiceListEditor kind="portion" value={formChoices.portions} onChange={v => setFormChoices(c => ({ ...c, portions: v }))} />
              <ChoiceListEditor kind="extra" value={formChoices.extras} onChange={v => setFormChoices(c => ({ ...c, extras: v }))} />

              <OptionGroupsEditor groups={formGroups} onChange={setFormGroups} />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      <MenuSectionsEditor
        visible={sectionsOpen}
        sections={sections}
        itemCounts={sectionCounts}
        onClose={() => setSectionsOpen(false)}
        onSaved={onSectionsSaved}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 10 },
  groupTitle: { fontSize: 17, lineHeight: 22, fontFamily: fonts.display, letterSpacing: -0.3, marginTop: 6 },
  groupCount: { fontSize: 13, fontFamily: fonts.semibold },
  orderBtns: { flexDirection: 'row', gap: 4, marginLeft: 'auto', marginRight: 8 },
  orderBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
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
