import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import BottomSheet, { BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';

import { colors } from '@/constants/theme';
import { useCart } from '@/lib/cart-context';
import { useFavorites } from '@/lib/favorites-context';
import { useRecentlyViewed } from '@/lib/recently-viewed';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';
import { shareSeller } from '@/lib/social-share';
import type { MenuItem, Seller } from '@/types';
import FoodImage from '@/components/shared/FoodImage';
import { getSellerImage, getMenuImage } from '@/lib/food-images';

const { width: SCREEN_W } = Dimensions.get('window');

function priceTL(cents: number): string {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

// ─── Demo Data ────────────────────────────────────────────────────────────────

const SELLER_AVATARS: Record<string, { emoji: string; bg: string }> = {
  'demo-1': { emoji: '🍲', bg: '#FFF3E0' },
  'demo-2': { emoji: '🥟', bg: '#E8F5E9' },
  'demo-3': { emoji: '🐟', bg: '#E3F2FD' },
  'demo-4': { emoji: '🎂', bg: '#FCE4EC' },
  'demo-5': { emoji: '🥩', bg: '#FBE9E7' },
  'demo-6': { emoji: '🍳', bg: '#FFFDE7' },
};

type WorkingHours = { day: string; hours: string; open: boolean };

const WORKING_HOURS: Record<string, WorkingHours[]> = {
  'demo-1': [
    { day: 'Pazartesi', hours: '09:00 - 21:00', open: true },
    { day: 'Salı', hours: '09:00 - 21:00', open: true },
    { day: 'Çarşamba', hours: '09:00 - 21:00', open: true },
    { day: 'Perşembe', hours: '09:00 - 21:00', open: true },
    { day: 'Cuma', hours: '09:00 - 22:00', open: true },
    { day: 'Cumartesi', hours: '10:00 - 22:00', open: true },
    { day: 'Pazar', hours: '10:00 - 20:00', open: true },
  ],
  'demo-2': [
    { day: 'Pazartesi', hours: '10:00 - 20:00', open: true },
    { day: 'Salı', hours: '10:00 - 20:00', open: true },
    { day: 'Çarşamba', hours: '10:00 - 20:00', open: true },
    { day: 'Perşembe', hours: '10:00 - 20:00', open: true },
    { day: 'Cuma', hours: '10:00 - 21:00', open: true },
    { day: 'Cumartesi', hours: '10:00 - 21:00', open: true },
    { day: 'Pazar', hours: 'Kapalı', open: false },
  ],
  'demo-3': [
    { day: 'Pazartesi', hours: '08:00 - 22:00', open: true },
    { day: 'Salı', hours: '08:00 - 22:00', open: true },
    { day: 'Çarşamba', hours: '08:00 - 22:00', open: true },
    { day: 'Perşembe', hours: '08:00 - 22:00', open: true },
    { day: 'Cuma', hours: '08:00 - 23:00', open: true },
    { day: 'Cumartesi', hours: '09:00 - 23:00', open: true },
    { day: 'Pazar', hours: '09:00 - 21:00', open: true },
  ],
  'demo-4': [
    { day: 'Pazartesi', hours: '10:00 - 20:00', open: true },
    { day: 'Salı', hours: '10:00 - 20:00', open: true },
    { day: 'Çarşamba', hours: '10:00 - 20:00', open: true },
    { day: 'Perşembe', hours: '10:00 - 20:00', open: true },
    { day: 'Cuma', hours: '10:00 - 21:00', open: true },
    { day: 'Cumartesi', hours: '10:00 - 21:00', open: true },
    { day: 'Pazar', hours: '11:00 - 19:00', open: true },
  ],
  'demo-5': [
    { day: 'Pazartesi', hours: '11:00 - 22:00', open: true },
    { day: 'Salı', hours: '11:00 - 22:00', open: true },
    { day: 'Çarşamba', hours: '11:00 - 22:00', open: true },
    { day: 'Perşembe', hours: '11:00 - 22:00', open: true },
    { day: 'Cuma', hours: '11:00 - 23:00', open: true },
    { day: 'Cumartesi', hours: '12:00 - 23:00', open: true },
    { day: 'Pazar', hours: 'Kapalı', open: false },
  ],
  'demo-6': [
    { day: 'Pazartesi', hours: '07:00 - 14:00', open: true },
    { day: 'Salı', hours: '07:00 - 14:00', open: true },
    { day: 'Çarşamba', hours: '07:00 - 14:00', open: true },
    { day: 'Perşembe', hours: '07:00 - 14:00', open: true },
    { day: 'Cuma', hours: '07:00 - 15:00', open: true },
    { day: 'Cumartesi', hours: '08:00 - 15:00', open: true },
    { day: 'Pazar', hours: '08:00 - 14:00', open: true },
  ],
};

const DEMO_SELLERS: Record<string, Seller & { deliveryTime: string; minOrder: number }> = {
  'demo-1': {
    id: 'demo-1', user_id: 'u1', display_name: "Ayşe'nin Ev Yemekleri",
    bio: 'Her gün taze pişirilen geleneksel Türk yemekleri. Anneannemden kalma tariflerle, doğal malzemelerle hazırlanan ev lezzetleri.',
    city: 'İstanbul', district: 'Kadıköy', address_line: 'Caferağa Mah.', latitude: 40.9903, longitude: 29.0278,
    rating_avg: 4.8, rating_count: 124, is_active: true, created_at: '', updated_at: '',
    deliveryTime: '25-35', minOrder: 5000,
  },
  'demo-2': {
    id: 'demo-2', user_id: 'u2', display_name: 'Fatma Hanım Mutfağı',
    bio: 'Ege usulü zeytinyağlı yemekler ve taze börekler. Her gün el açması yufka ile hazırlanır.',
    city: 'İstanbul', district: 'Beşiktaş', address_line: 'Sinanpaşa Mah.', latitude: 41.0422, longitude: 29.0099,
    rating_avg: 4.6, rating_count: 87, is_active: true, created_at: '', updated_at: '',
    deliveryTime: '30-40', minOrder: 6000,
  },
  'demo-3': {
    id: 'demo-3', user_id: 'u3', display_name: 'Mehmet Usta Karadeniz',
    bio: 'Karadeniz mutfağının eşsiz tatları: hamsi, kuymak, mısır ekmeği. Trabzon usulü.',
    city: 'İstanbul', district: 'Üsküdar', address_line: 'Altunizade Mah.', latitude: 41.0233, longitude: 29.0151,
    rating_avg: 4.9, rating_count: 203, is_active: true, created_at: '', updated_at: '',
    deliveryTime: '20-30', minOrder: 4500,
  },
  'demo-4': {
    id: 'demo-4', user_id: 'u4', display_name: 'Zeynep Pasta & Tatlı',
    bio: 'El yapımı pastalar, kurabiyeler ve geleneksel tatlılar. Özel günlerinize lezzet katıyoruz.',
    city: 'İstanbul', district: 'Bakırköy', address_line: null, latitude: 40.9792, longitude: 28.8720,
    rating_avg: 4.7, rating_count: 56, is_active: true, created_at: '', updated_at: '',
    deliveryTime: '35-45', minOrder: 8000,
  },
  'demo-5': {
    id: 'demo-5', user_id: 'u5', display_name: 'Hüseyin Bey Izgara',
    bio: 'Mangalda pişirilen köfteler, tavuk şiş ve sebze ızgara. Günlük taze et kullanılır.',
    city: 'İstanbul', district: 'Şişli', address_line: null, latitude: 41.0602, longitude: 28.9877,
    rating_avg: 4.5, rating_count: 41, is_active: true, created_at: '', updated_at: '',
    deliveryTime: '25-35', minOrder: 7000,
  },
  'demo-6': {
    id: 'demo-6', user_id: 'u6', display_name: 'Elif Anne Kahvaltı',
    bio: 'Serpme kahvaltı, gözleme ve köy kahvaltısı. Her sabah taze hazırlanır.',
    city: 'İstanbul', district: 'Sarıyer', address_line: null, latitude: 41.1667, longitude: 29.0500,
    rating_avg: 4.8, rating_count: 92, is_active: true, created_at: '', updated_at: '',
    deliveryTime: '20-30', minOrder: 6000,
  },
};

type DemoReview = { id: string; name: string; rating: number; date: string; comment: string };

const DEMO_REVIEWS: Record<string, DemoReview[]> = {
  'demo-1': [
    { id: 'r1', name: 'Mehmet A.', rating: 5, date: '2 gün önce', comment: 'Kuru fasulye muhteşemdi, tam ev yemeği tadında. Kesinlikle tekrar sipariş vereceğim.' },
    { id: 'r2', name: 'Zeynep K.', rating: 4, date: '5 gün önce', comment: 'Çorba çok lezzetliydi ama teslimat biraz geç geldi.' },
    { id: 'r3', name: 'Ali B.', rating: 5, date: '1 hafta önce', comment: 'Her şey mükemmel, porsiyonlar büyük ve lezzetli.' },
  ],
  'demo-2': [
    { id: 'r1', name: 'Fatma Y.', rating: 5, date: '1 gün önce', comment: 'Börekler el açması, harika bir lezzet!' },
    { id: 'r2', name: 'Hasan T.', rating: 4, date: '3 gün önce', comment: 'Zeytinyağlılar çok güzel, ama biraz yağlı geldi.' },
  ],
  'demo-3': [
    { id: 'r1', name: 'Ayşe D.', rating: 5, date: '1 gün önce', comment: 'Hamsi tava ve kuymak inanılmazdı. Karadeniz lezzetini İstanbul\'a taşımışlar.' },
    { id: 'r2', name: 'Can M.', rating: 5, date: '4 gün önce', comment: 'Mısır ekmeği anneannemin yaptığı gibi!' },
    { id: 'r3', name: 'Elif S.', rating: 4, date: '1 hafta önce', comment: 'Genel olarak çok güzel ama porsiyon biraz küçük.' },
    { id: 'r4', name: 'Burak K.', rating: 5, date: '2 hafta önce', comment: 'En iyi Karadeniz mutfağı, sürekli sipariş veriyorum.' },
  ],
  'demo-4': [
    { id: 'r1', name: 'Selin A.', rating: 5, date: '2 gün önce', comment: 'Çikolatalı pasta muhteşemdi, doğum günü için sipariş verdim.' },
    { id: 'r2', name: 'Murat K.', rating: 4, date: '1 hafta önce', comment: 'Tatlılar güzel ama fiyatlar biraz yüksek.' },
  ],
  'demo-5': [
    { id: 'r1', name: 'Oğuz B.', rating: 4, date: '3 gün önce', comment: 'Köfteler çok lezzetli, ızgara tam kıvamında.' },
    { id: 'r2', name: 'Derya N.', rating: 5, date: '1 hafta önce', comment: 'Tavuk şiş bayıldım, marine muhteşem.' },
  ],
  'demo-6': [
    { id: 'r1', name: 'Gül T.', rating: 5, date: '1 gün önce', comment: 'Serpme kahvaltı harikaydı, her şey taptaze.' },
    { id: 'r2', name: 'Emre Y.', rating: 5, date: '3 gün önce', comment: 'Gözlemeler harika, köy kahvaltısı tam istediğim gibi.' },
    { id: 'r3', name: 'Nisa K.', rating: 4, date: '1 hafta önce', comment: 'Güzel ama kahvaltı saatleri biraz dar.' },
  ],
};

const ITEM_EMOJIS: Record<string, string> = {
  'm1-1': '🍜', 'm1-2': '🍚', 'm1-3': '🍖', 'm1-4': '🥗',
  'm2-1': '🥬', 'm2-2': '🥐', 'm2-3': '🌿',
  'm3-1': '🐟', 'm3-2': '🧀', 'm3-3': '🌽', 'm3-4': '🍵',
  'm4-1': '🎂', 'm4-2': '🍪', 'm4-3': '🍮',
  'm5-1': '🥩', 'm5-2': '🍗', 'm5-3': '🍽️',
  'm6-1': '🍳', 'm6-2': '🫓', 'm6-3': '🧈',
};

const ITEM_COLORS: Record<string, string> = {
  'm1-1': '#FFF3E0', 'm1-2': '#FFFDE7', 'm1-3': '#FBE9E7', 'm1-4': '#E8F5E9',
  'm2-1': '#E8F5E9', 'm2-2': '#FFF8E1', 'm2-3': '#F1F8E9',
  'm3-1': '#E3F2FD', 'm3-2': '#FFFDE7', 'm3-3': '#FFF8E1', 'm3-4': '#E8F5E9',
  'm4-1': '#FCE4EC', 'm4-2': '#FFF3E0', 'm4-3': '#FFF8E1',
  'm5-1': '#FBE9E7', 'm5-2': '#FFF3E0', 'm5-3': '#FFEBEE',
  'm6-1': '#FFFDE7', 'm6-2': '#FFF8E1', 'm6-3': '#FFF3E0',
};

const DEMO_MENUS: Record<string, MenuItem[]> = {
  'demo-1': [
    { id: 'm1-1', seller_id: 'demo-1', title: 'Mercimek Çorbası', description: 'Günlük taze kırmızı mercimek çorbası, limon ve nane ile', price_cents: 4500, currency: 'TRY', image_url: null, is_available: true, category: 'Çorbalar', badge: 'popular' as const, variants: [{ id: 'v1', label: 'Normal', priceDiffCents: 0 }, { id: 'v2', label: 'Büyük Boy', priceDiffCents: 1500 }], created_at: '', updated_at: '' },
    { id: 'm1-2', seller_id: 'demo-1', title: 'Kuru Fasulye + Pilav', description: 'Geleneksel tarif, yanında tereyağlı pirinç pilavı', price_cents: 8000, currency: 'TRY', image_url: null, is_available: true, category: 'Ana Yemekler', badge: 'popular' as const, variants: [{ id: 'v1', label: 'Normal', priceDiffCents: 0 }, { id: 'v2', label: 'Büyük Porsiyon', priceDiffCents: 2500 }], extras: [{ id: 'e1', label: 'Ekstra Pilav', priceCents: 1500 }, { id: 'e2', label: 'Cacık', priceCents: 1000 }], created_at: '', updated_at: '' },
    { id: 'm1-3', seller_id: 'demo-1', title: 'İzmir Köfte', description: 'Domates soslu fırın köfte, patates ve biber ile', price_cents: 9500, currency: 'TRY', image_url: null, is_available: true, category: 'Ana Yemekler', extras: [{ id: 'e1', label: 'Ekstra Ekmek', priceCents: 500 }, { id: 'e2', label: 'Yoğurt', priceCents: 1000 }], created_at: '', updated_at: '' },
    { id: 'm1-4', seller_id: 'demo-1', title: 'Karışık Salata', description: 'Mevsim yeşillikleri, domates, salatalık, zeytin', price_cents: 3500, currency: 'TRY', image_url: null, is_available: true, category: 'Yan Lezzetler', created_at: '', updated_at: '' },
  ],
  'demo-2': [
    { id: 'm2-1', seller_id: 'demo-2', title: 'Zeytinyağlı Enginar', description: 'Taze enginar, havuç ve bezelye ile, soğuk servis', price_cents: 7000, currency: 'TRY', image_url: null, is_available: true, category: 'Zeytinyağlılar', badge: 'popular' as const, created_at: '', updated_at: '' },
    { id: 'm2-2', seller_id: 'demo-2', title: 'Ispanaklı Börek', description: 'El açması yufka, lor peyniri ve ıspanak ile', price_cents: 6500, currency: 'TRY', image_url: null, is_available: true, category: 'Börekler', variants: [{ id: 'v1', label: 'Yarım', priceDiffCents: 0 }, { id: 'v2', label: 'Tam Tepsi', priceDiffCents: 5000 }], created_at: '', updated_at: '' },
    { id: 'm2-3', seller_id: 'demo-2', title: 'Zeytinyağlı Dolma', description: 'Fıstıklı ve kuş üzümlü yaprak sarma', price_cents: 7500, currency: 'TRY', image_url: null, is_available: true, category: 'Zeytinyağlılar', badge: 'new' as const, created_at: '', updated_at: '' },
  ],
  'demo-3': [
    { id: 'm3-1', seller_id: 'demo-3', title: 'Hamsi Tava', description: 'Taze hamsi, mısır ununda kızartılmış', price_cents: 11000, currency: 'TRY', image_url: null, is_available: true, category: 'Ana Yemekler', badge: 'popular' as const, created_at: '', updated_at: '' },
    { id: 'm3-2', seller_id: 'demo-3', title: 'Kuymak (Muhlama)', description: 'Mısır unu ve kaşar peyniri ile', price_cents: 8500, currency: 'TRY', image_url: null, is_available: true, category: 'Ana Yemekler', badge: 'spicy' as const, extras: [{ id: 'e1', label: 'Ekstra Kaşar', priceCents: 2000 }], created_at: '', updated_at: '' },
    { id: 'm3-3', seller_id: 'demo-3', title: 'Mısır Ekmeği', description: 'Günlük taze pişirilmiş (2 adet)', price_cents: 3000, currency: 'TRY', image_url: null, is_available: true, category: 'Yan Lezzetler', created_at: '', updated_at: '' },
    { id: 'm3-4', seller_id: 'demo-3', title: 'Karalahana Çorbası', description: 'Geleneksel Karadeniz usulü', price_cents: 5000, currency: 'TRY', image_url: null, is_available: true, category: 'Çorbalar', badge: 'new' as const, created_at: '', updated_at: '' },
  ],
  'demo-4': [
    { id: 'm4-1', seller_id: 'demo-4', title: 'Çikolatalı Yaş Pasta', description: 'Bitter çikolata ganajlı, 6 kişilik', price_cents: 35000, currency: 'TRY', image_url: null, is_available: true, category: 'Pastalar', badge: 'popular' as const, variants: [{ id: 'v1', label: '4 Kişilik', priceDiffCents: -10000 }, { id: 'v2', label: '6 Kişilik', priceDiffCents: 0 }, { id: 'v3', label: '10 Kişilik', priceDiffCents: 15000 }], created_at: '', updated_at: '' },
    { id: 'm4-2', seller_id: 'demo-4', title: 'Kurabiye Kutusu', description: '12 adet karışık el yapımı kurabiye', price_cents: 15000, currency: 'TRY', image_url: null, is_available: true, category: 'Kurabiyeler', variants: [{ id: 'v1', label: '12 Adet', priceDiffCents: 0 }, { id: 'v2', label: '24 Adet', priceDiffCents: 12000 }], created_at: '', updated_at: '' },
    { id: 'm4-3', seller_id: 'demo-4', title: 'Fırın Sütlaç', description: 'Geleneksel fırında pişirilmiş, 2 kişilik', price_cents: 8000, currency: 'TRY', image_url: null, is_available: true, category: 'Tatlılar', badge: 'new' as const, created_at: '', updated_at: '' },
  ],
  'demo-5': [
    { id: 'm5-1', seller_id: 'demo-5', title: 'Izgara Köfte (5 Adet)', description: 'El yapımı dana köfte, mangalda pişirilmiş', price_cents: 12000, currency: 'TRY', image_url: null, is_available: true, category: 'Izgaralar', badge: 'popular' as const, extras: [{ id: 'e1', label: 'Acı Sos', priceCents: 500 }, { id: 'e2', label: 'Ekstra Ekmek', priceCents: 500 }], created_at: '', updated_at: '' },
    { id: 'm5-2', seller_id: 'demo-5', title: 'Tavuk Şiş', description: '3 şiş marine tavuk, yanında pilav ve salata', price_cents: 13500, currency: 'TRY', image_url: null, is_available: true, category: 'Izgaralar', variants: [{ id: 'v1', label: 'Normal', priceDiffCents: 0 }, { id: 'v2', label: 'Double', priceDiffCents: 7000 }], created_at: '', updated_at: '' },
    { id: 'm5-3', seller_id: 'demo-5', title: 'Karışık Izgara Tabağı', description: 'Köfte, tavuk şiş, kanat + közlenmiş sebze', price_cents: 18000, currency: 'TRY', image_url: null, is_available: true, category: 'Izgaralar', badge: 'spicy' as const, created_at: '', updated_at: '' },
  ],
  'demo-6': [
    { id: 'm6-1', seller_id: 'demo-6', title: 'Serpme Kahvaltı (2 Kişilik)', description: 'Peynir tabağı, zeytin, bal, kaymak, yumurta, reçel', price_cents: 25000, currency: 'TRY', image_url: null, is_available: true, category: 'Kahvaltılar', badge: 'popular' as const, variants: [{ id: 'v1', label: '2 Kişilik', priceDiffCents: 0 }, { id: 'v2', label: '4 Kişilik', priceDiffCents: 20000 }], extras: [{ id: 'e1', label: 'Sucuklu Yumurta', priceCents: 3500 }, { id: 'e2', label: 'Ekstra Peynir Tabağı', priceCents: 4000 }], created_at: '', updated_at: '' },
    { id: 'm6-2', seller_id: 'demo-6', title: 'Gözleme', description: 'El açması yufka, peynir veya patates seçenekli', price_cents: 6000, currency: 'TRY', image_url: null, is_available: true, category: 'Hamur İşleri', variants: [{ id: 'v1', label: 'Peynirli', priceDiffCents: 0 }, { id: 'v2', label: 'Kıymalı', priceDiffCents: 2000 }, { id: 'v3', label: 'Patatesli', priceDiffCents: 0 }], created_at: '', updated_at: '' },
    { id: 'm6-3', seller_id: 'demo-6', title: 'Menemen', description: 'Domates, biber ve yumurta, tereyağında pişirilmiş', price_cents: 5500, currency: 'TRY', image_url: null, is_available: true, category: 'Kahvaltılar', extras: [{ id: 'e1', label: 'Sucuklu', priceCents: 2000 }, { id: 'e2', label: 'Kaşarlı', priceCents: 1500 }], created_at: '', updated_at: '' },
  ],
};

// ─── Info Chip Component ──────────────────────────────────────────────────────

function InfoChip({ icon, label, accent }: { icon: string; label: string; accent?: boolean }) {
  return (
    <View style={[st.chip, accent && st.chipAccent]}>
      <Text style={st.chipIcon}>{icon}</Text>
      <Text style={[st.chipLabel, accent && st.chipLabelAccent]}>{label}</Text>
    </View>
  );
}

// ─── Menu Item Card ───────────────────────────────────────────────────────────

const BADGE_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  popular: { label: '🔥 Popüler', bg: '#FFF3E0', text: '#E65100' },
  new: { label: '✨ Yeni', bg: '#E8F5E9', text: '#2E7D32' },
  spicy: { label: '🌶️ Acılı', bg: '#FFEBEE', text: '#C62828' },
};

function MenuCard({
  item,
  emoji,
  bgColor,
  qty,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  item: MenuItem;
  emoji: string;
  bgColor: string;
  qty: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const { colors: t } = useTheme();
  const badge = item.badge ? BADGE_CONFIG[item.badge] : null;
  const hasOptions = (item.variants && item.variants.length > 0) || (item.extras && item.extras.length > 0);

  return (
    <View style={[st.menuCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }, !item.is_available && st.menuCardDisabled]}>
      {/* Sol: görsel */}
      <View style={st.menuLeft}>
        <FoodImage
          imageUrl={item.image_url}
          localImage={getMenuImage(item.id).image}
          emoji={emoji}
          bg={bgColor}
          size={64}
          borderRadius={14}
        />
      </View>

      {/* Orta: bilgi */}
      <View style={st.menuCenter}>
        <View style={st.menuTitleRow}>
          <Text style={[st.menuTitle, { color: t.text }]} numberOfLines={1}>{item.title}</Text>
          {badge && (
            <View style={[st.badgePill, { backgroundColor: badge.bg }]}>
              <Text style={[st.badgeText, { color: badge.text }]}>{badge.label}</Text>
            </View>
          )}
        </View>
        {item.description ? (
          <Text style={[st.menuDesc, { color: t.textMuted }]} numberOfLines={2}>{item.description}</Text>
        ) : null}
        <View style={st.menuPriceRow}>
          <Text style={st.menuPrice}>{priceTL(item.price_cents)}</Text>
          {hasOptions && (
            <Text style={st.optionsHint}>Seçenekler mevcut</Text>
          )}
        </View>
      </View>

      {/* Sağ: sepet kontrol */}
      <View style={st.menuRight}>
        {!item.is_available ? (
          <View style={st.soldOut}>
            <Text style={st.soldOutText}>Tükendi</Text>
          </View>
        ) : qty === 0 ? (
          <Pressable style={st.addBtn} onPress={onAdd}>
            <Text style={st.addBtnPlus}>+</Text>
          </Pressable>
        ) : (
          <View style={st.qtyControl}>
            <Pressable style={st.qtyBtn} onPress={onDecrement} hitSlop={8}>
              <Text style={st.qtyBtnText}>−</Text>
            </Pressable>
            <Text style={st.qtyNum}>{qty}</Text>
            <Pressable style={[st.qtyBtn, st.qtyBtnAdd]} onPress={onIncrement} hitSlop={8}>
              <Text style={[st.qtyBtnText, st.qtyBtnAddText]}>+</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SellerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors: t } = useTheme();
  const {
    sellerId: cartSellerId,
    items: cartItems,
    totalItems,
    totalCents,
    addItem,
    forceAdd,
    incrementItem,
    decrementItem,
  } = useCart();
  const { addRecent } = useRecentlyViewed();
  const { isFavorite, toggleFavorite } = useFavorites();

  const [seller, setSeller] = useState<(Seller & { deliveryTime: string; minOrder: number }) | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHours, setShowHours] = useState(false);
  const [optionsItem, setOptionsItem] = useState<MenuItem | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [selectedExtras, setSelectedExtras] = useState<Set<string>>(new Set());
  const scrollY = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(1)).current;
  const optionsSheetRef = useRef<BottomSheet>(null);
  const optionsSnapPoints = useMemo(() => ['55%', '80%'], []);

  const isFav = isFavorite(id ?? '');

  useEffect(() => {
    if (!id) return;
    setSeller(DEMO_SELLERS[id] ?? null);
    setMenuItems(DEMO_MENUS[id] ?? []);
    setLoading(false);
    addRecent(id);
  }, [id, addRecent]);

  const toggleFav = useCallback(() => {
    toggleFavorite(id!);
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.4, friction: 3, tension: 200, useNativeDriver: true }),
      Animated.spring(heartScale, { toValue: 1, friction: 5, useNativeDriver: true }),
    ]).start();
  }, [id, heartScale, toggleFavorite]);

  const openOptionsOrAdd = useCallback(
    (item: MenuItem) => {
      const hasOptions = (item.variants && item.variants.length > 0) || (item.extras && item.extras.length > 0);
      if (hasOptions) {
        setOptionsItem(item);
        setSelectedVariant(item.variants?.[0]?.id ?? null);
        setSelectedExtras(new Set());
        optionsSheetRef.current?.snapToIndex(0);
        return;
      }
      doAdd(item, item.price_cents, item.title);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );

  const doAdd = useCallback(
    (item: MenuItem, priceCents: number, title: string) => {
      const ok = addItem(id!, {
        menuItemId: item.id,
        title,
        priceCents,
      });
      if (!ok) {
        Alert.alert(
          'Sepeti Temizle?',
          'Sepetinizde başka bir satıcıdan ürün var. Devam etmek için sepet temizlenecek.',
          [
            { text: 'İptal', style: 'cancel' },
            {
              text: 'Temizle ve Ekle',
              style: 'destructive',
              onPress: () =>
                forceAdd(id!, {
                  menuItemId: item.id,
                  title,
                  priceCents,
                }),
            },
          ],
        );
      }
    },
    [id, addItem, forceAdd],
  );

  const confirmOptions = useCallback(() => {
    if (!optionsItem) return;
    const variant = optionsItem.variants?.find(v => v.id === selectedVariant);
    const extrasArr = optionsItem.extras?.filter(e => selectedExtras.has(e.id)) ?? [];
    const extrasCents = extrasArr.reduce((sum, e) => sum + e.priceCents, 0);
    const variantDiff = variant?.priceDiffCents ?? 0;
    const totalPrice = optionsItem.price_cents + variantDiff + extrasCents;

    const parts = [optionsItem.title];
    if (variant && optionsItem.variants && optionsItem.variants.length > 1) parts.push(`(${variant.label})`);
    if (extrasArr.length > 0) parts.push(`+ ${extrasArr.map(e => e.label).join(', ')}`);
    const title = parts.join(' ');

    doAdd(optionsItem, totalPrice, title);
    setOptionsItem(null);
    optionsSheetRef.current?.close();
  }, [optionsItem, selectedVariant, selectedExtras, doAdd]);

  const fromThisSeller = cartSellerId === id;

  // Sticky header opacity
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 140, 180],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });

  if (loading) {
    return (
      <View style={[st.loadingWrap, { backgroundColor: t.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!seller) {
    return (
      <SafeAreaView style={[st.safe, { backgroundColor: t.background }]} edges={['top']}>
        <View style={st.errorWrap}>
          <Text style={st.errorEmoji}>😕</Text>
          <Text style={[st.errorTitle, { color: t.text }]}>Satıcı bulunamadı</Text>
          <Pressable style={st.errorBtn} onPress={() => router.back()}>
            <Text style={st.errorBtnText}>← Geri dön</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const avatar = SELLER_AVATARS[id!] ?? { emoji: '🍽️', bg: '#FFF3E0' };
  const hasCart = fromThisSeller && totalItems > 0;

  return (
    <View style={[st.safe, { backgroundColor: t.background }]}>
      {/* ═══ Sticky Header (scroll'da görünür — blur glass) ═══ */}
      <Animated.View style={[st.stickyHeader, { opacity: headerOpacity, backgroundColor: t.surface + 'B3' }]}>
        <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['top']} style={st.stickyInner}>
          <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
            <Text style={st.backIcon}>‹</Text>
          </Pressable>
          <Text style={[st.stickyTitle, { color: t.text }]} numberOfLines={1}>{seller.display_name}</Text>
          <View style={st.stickyRating}>
            <Text style={st.stickyRatingStar}>★</Text>
            <Text style={st.stickyRatingNum}>{Number(seller.rating_avg).toFixed(1)}</Text>
          </View>
        </SafeAreaView>
      </Animated.View>

      {/* ═══ Floating back & fav button (hero üstünde) ═══ */}
      <SafeAreaView edges={['top']} style={st.floatingBackWrap}>
        <View style={st.floatingRow}>
          <Pressable style={st.floatingBtn} onPress={() => router.back()} hitSlop={12}>
            <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />
            <Text style={st.floatingBtnIcon}>‹</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              style={st.floatingBtn}
              onPress={() => seller && shareSeller(seller.display_name, Number(seller.rating_avg), seller.district ?? '')}
              hitSlop={12}
            >
              <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />
              <Text style={st.floatingBtnIcon}>↗</Text>
            </Pressable>
            <Pressable style={st.floatingBtn} onPress={toggleFav} hitSlop={12}>
              <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />
              <Animated.Text style={[st.floatingFavIcon, { transform: [{ scale: heartScale }] }]}>
                {isFav ? '❤️' : '🤍'}
              </Animated.Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[st.scroll, hasCart && { paddingBottom: 110 }]}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
      >
        {/* ═══ HERO COVER ═══ */}
        <View style={[st.heroCover, { backgroundColor: avatar.bg }]}>
          <FoodImage
            localImage={getSellerImage(id!).image}
            emoji={avatar.emoji}
            bg={avatar.bg}
            size={SCREEN_W}
            borderRadius={0}
            fontSize={72}
            style={{ width: SCREEN_W, height: 200 }}
          />
          {/* Gradient overlay alttan */}
          <View style={st.heroGradient} />
        </View>

        {/* ═══ SELLER INFO ═══ */}
        <View style={[st.infoSection, { backgroundColor: t.surface }]}>
          <Text style={[st.sellerName, { color: t.text }]}>{seller.display_name}</Text>

          {/* Rating bar */}
          <View style={st.ratingRow}>
            <View style={st.ratingBadge}>
              <Text style={st.ratingStarBig}>★</Text>
              <Text style={st.ratingNumBig}>{Number(seller.rating_avg).toFixed(1)}</Text>
            </View>
            <Text style={[st.ratingCountText, { color: t.textMuted }]}>{seller.rating_count} değerlendirme</Text>
            <View style={st.ratingDivider} />
            <Text style={st.verifiedText}>✓ Onaylı Mutfak</Text>
          </View>

          {seller.bio ? (
            <Text style={[st.sellerBio, { color: t.textSecondary }]}>{seller.bio}</Text>
          ) : null}

          {/* Info chips — Yemeksepeti tarzı */}
          <View style={st.chipsRow}>
            <InfoChip icon="🕐" label={`${seller.deliveryTime} dk`} />
            <InfoChip icon="💰" label={`Min ${priceTL(seller.minOrder)}`} />
            <InfoChip icon="📍" label={seller.district ?? seller.city ?? ''} />
            <InfoChip icon="🟢" label="Açık" accent />
          </View>
        </View>

        {/* ═══ MENÜ ═══ */}
        <View style={[st.menuSection, { backgroundColor: t.background }]}>
          <View style={st.menuHeader}>
            <Text style={[st.menuHeading, { color: t.text }]}>Menü</Text>
            <Text style={[st.menuCount, { color: t.textMuted }]}>{menuItems.length} ürün</Text>
          </View>

          {menuItems.length === 0 ? (
            <View style={st.emptyMenu}>
              <Text style={st.emptyEmoji}>🍽️</Text>
              <Text style={st.emptyText}>Şu an aktif ürün bulunmuyor</Text>
            </View>
          ) : (
            <View style={st.menuList}>
              {(() => {
                const categories: string[] = [];
                menuItems.forEach(item => {
                  const cat = item.category ?? 'Diğer';
                  if (!categories.includes(cat)) categories.push(cat);
                });
                return categories.map(cat => (
                  <View key={cat}>
                    <View style={[st.catHeader, { borderBottomColor: t.surfaceBorder }]}>
                      <Text style={[st.catHeaderText, { color: t.text }]}>{cat}</Text>
                      <Text style={[st.catHeaderCount, { color: t.textMuted }]}>
                        {menuItems.filter(i => (i.category ?? 'Diğer') === cat).length} ürün
                      </Text>
                    </View>
                    {menuItems
                      .filter(i => (i.category ?? 'Diğer') === cat)
                      .map(item => {
                        const cartItem = fromThisSeller
                          ? cartItems.find(ci => ci.menuItemId === item.id)
                          : undefined;
                        const qty = cartItem?.quantity ?? 0;
                        const emoji = ITEM_EMOJIS[item.id] ?? '🍽️';
                        const bgColor = ITEM_COLORS[item.id] ?? '#FAF7F2';
                        return (
                          <MenuCard
                            key={item.id}
                            item={item}
                            emoji={emoji}
                            bgColor={bgColor}
                            qty={qty}
                            onAdd={() => openOptionsOrAdd(item)}
                            onIncrement={() => incrementItem(item.id)}
                            onDecrement={() => decrementItem(item.id)}
                          />
                        );
                      })}
                  </View>
                ));
              })()}
            </View>
          )}
        </View>

        {/* ═══ ÇALIŞMA SAATLERİ ═══ */}
        {WORKING_HOURS[id!] && (
          <View style={[st.hoursSection, { backgroundColor: t.surface }]}>
            <Pressable style={st.hoursTitleRow} onPress={() => setShowHours(!showHours)}>
              <Text style={[st.hoursHeading, { color: t.text }]}>🕐 Çalışma Saatleri</Text>
              <Text style={st.hoursToggle}>{showHours ? '▲' : '▼'}</Text>
            </Pressable>
            {showHours && (
              <View style={st.hoursCard}>
                {WORKING_HOURS[id!].map((wh, idx) => {
                  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
                  const isToday = idx === todayIdx;
                  return (
                    <View key={wh.day} style={[st.hoursRow, isToday && st.hoursRowToday]}>
                      <Text style={[st.hoursDay, isToday && st.hoursDayToday]}>{wh.day}</Text>
                      <Text style={[st.hoursTime, !wh.open && st.hoursTimeClosed, isToday && st.hoursTimeToday]}>
                        {wh.hours}
                      </Text>
                      {isToday && <View style={st.hoursTodayDot} />}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ═══ YORUMLAR ═══ */}
        {(DEMO_REVIEWS[id!] ?? []).length > 0 && (
          <View style={[st.reviewsSection, { backgroundColor: t.surface }]}>
            <View style={st.menuHeader}>
              <Text style={[st.menuHeading, { color: t.text }]}>Değerlendirmeler</Text>
              <Text style={[st.menuCount, { color: t.textMuted }]}>{(DEMO_REVIEWS[id!] ?? []).length} yorum</Text>
            </View>

            {/* Rating Summary */}
            {seller && (
              <View style={st.ratingSummary}>
                <View style={st.ratingSummaryLeft}>
                  <Text style={st.ratingSummaryNum}>{Number(seller.rating_avg).toFixed(1)}</Text>
                  <View style={st.ratingSummaryStars}>
                    {[1, 2, 3, 4, 5].map(s => (
                      <Text key={s} style={[st.reviewStar, s <= Math.round(seller.rating_avg ?? 0) && st.reviewStarActive]}>★</Text>
                    ))}
                  </View>
                  <Text style={st.ratingSummaryCount}>{seller.rating_count} değerlendirme</Text>
                </View>
                <View style={st.ratingSummaryBars}>
                  {[5, 4, 3, 2, 1].map(star => {
                    const reviews = DEMO_REVIEWS[id!] ?? [];
                    const count = reviews.filter(r => r.rating === star).length;
                    const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                    return (
                      <View key={star} style={st.ratingBarRow}>
                        <Text style={st.ratingBarLabel}>{star}</Text>
                        <View style={st.ratingBarTrack}>
                          <View style={[st.ratingBarFill, { width: `${Math.max(pct, 2)}%` }]} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {(DEMO_REVIEWS[id!] ?? []).map(rev => (
              <View key={rev.id} style={[st.reviewCard, { borderTopColor: t.surfaceBorder }]}>
                <View style={st.reviewTop}>
                  <View style={st.reviewAvatar}>
                    <Text style={st.reviewAvatarText}>{rev.name.charAt(0)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[st.reviewName, { color: t.text }]}>{rev.name}</Text>
                    <Text style={[st.reviewDate, { color: t.textMuted }]}>{rev.date}</Text>
                  </View>
                  <View style={st.reviewStars}>
                    {[1, 2, 3, 4, 5].map(s => (
                      <Text key={s} style={[st.reviewStar, s <= rev.rating && st.reviewStarActive]}>★</Text>
                    ))}
                  </View>
                </View>
                <Text style={[st.reviewComment, { color: t.textSecondary }]}>{rev.comment}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ═══ SATICI BİLGİLERİ ═══ */}
        <View style={[st.aboutSection, { backgroundColor: t.background }]}>
          <Text style={[st.aboutHeading, { color: t.text }]}>Satıcı Hakkında</Text>
          <View style={[st.aboutCard, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
            <View style={st.aboutRow}>
              <Text style={st.aboutLabel}>📍 Konum</Text>
              <Text style={st.aboutValue}>
                {[seller.address_line, seller.district, seller.city].filter(Boolean).join(', ')}
              </Text>
            </View>
            <View style={st.aboutDivider} />
            <View style={st.aboutRow}>
              <Text style={st.aboutLabel}>🕐 Teslimat</Text>
              <Text style={st.aboutValue}>{seller.deliveryTime} dakika</Text>
            </View>
            <View style={st.aboutDivider} />
            <View style={st.aboutRow}>
              <Text style={st.aboutLabel}>💰 Min. Sipariş</Text>
              <Text style={st.aboutValue}>{priceTL(seller.minOrder)}</Text>
            </View>
            <View style={st.aboutDivider} />
            <View style={st.aboutRow}>
              <Text style={st.aboutLabel}>⭐ Puan</Text>
              <Text style={st.aboutValue}>
                {Number(seller.rating_avg).toFixed(1)} ({seller.rating_count} yorum)
              </Text>
            </View>
          </View>
        </View>
      </Animated.ScrollView>

      {/* ═══ CART BAR ═══ */}
      {hasCart && (
        <View style={st.cartBar}>
          <SafeAreaView edges={['bottom']} style={st.cartBarInner}>
            <View style={st.cartBarLeft}>
              <View style={st.cartBadge}>
                <Text style={st.cartBadgeText}>{totalItems}</Text>
              </View>
              <View>
                <Text style={st.cartBarLabel}>Sepeti Görüntüle</Text>
                <Text style={st.cartBarPrice}>{priceTL(totalCents)}</Text>
              </View>
            </View>
            <Pressable
              style={st.cartBarBtn}
              onPress={() => router.push('/(customer)/cart')}
            >
              <Text style={st.cartBarBtnText}>Sepete Git →</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      )}
      {/* VARIANT / EXTRAS BOTTOM SHEET */}
      <BottomSheet
        ref={optionsSheetRef}
        index={-1}
        snapPoints={optionsSnapPoints}
        enablePanDownToClose
        onClose={() => setOptionsItem(null)}
        backdropComponent={(props) => (
          <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
        )}
        handleIndicatorStyle={{ backgroundColor: '#D0C8BC', width: 40 }}
        backgroundStyle={[st.optionsCard, { backgroundColor: t.surface }]}
      >
        <BottomSheetView style={st.optionsInner}>
          {optionsItem && (
            <>
              <View style={st.optionsHeader}>
                <Text style={st.optionsTitle}>{optionsItem.title}</Text>
                <Pressable onPress={() => optionsSheetRef.current?.close()} hitSlop={8}>
                  <Text style={st.optionsClose}>✕</Text>
                </Pressable>
              </View>

              {optionsItem.description ? (
                <Text style={st.optionsDesc}>{optionsItem.description}</Text>
              ) : null}

              {/* Variants */}
              {optionsItem.variants && optionsItem.variants.length > 0 && (
                <View style={st.optionsSection}>
                  <Text style={st.optionsSectionTitle}>Porsiyon / Boyut</Text>
                  {optionsItem.variants.map(v => {
                    const active = selectedVariant === v.id;
                    return (
                      <Pressable
                        key={v.id}
                        style={[st.optionRow, active && st.optionRowActive]}
                        onPress={() => setSelectedVariant(v.id)}
                      >
                        <View style={[st.optionRadio, active && st.optionRadioActive]}>
                          {active && <View style={st.optionRadioDot} />}
                        </View>
                        <Text style={[st.optionLabel, active && st.optionLabelActive]}>{v.label}</Text>
                        <Text style={st.optionPrice}>
                          {v.priceDiffCents === 0
                            ? ''
                            : v.priceDiffCents > 0
                              ? `+${priceTL(v.priceDiffCents)}`
                              : `-${priceTL(Math.abs(v.priceDiffCents))}`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Extras */}
              {optionsItem.extras && optionsItem.extras.length > 0 && (
                <View style={st.optionsSection}>
                  <Text style={st.optionsSectionTitle}>Ekstralar</Text>
                  {optionsItem.extras.map(e => {
                    const checked = selectedExtras.has(e.id);
                    return (
                      <Pressable
                        key={e.id}
                        style={[st.optionRow, checked && st.optionRowActive]}
                        onPress={() => setSelectedExtras(prev => {
                          const next = new Set(prev);
                          if (next.has(e.id)) next.delete(e.id);
                          else next.add(e.id);
                          return next;
                        })}
                      >
                        <View style={[st.optionCheck, checked && st.optionCheckActive]}>
                          {checked && <Text style={st.optionCheckMark}>✓</Text>}
                        </View>
                        <Text style={[st.optionLabel, checked && st.optionLabelActive]}>{e.label}</Text>
                        <Text style={st.optionPrice}>+{priceTL(e.priceCents)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Total & Confirm */}
              <View style={st.optionsFooter}>
                <Text style={st.optionsTotal}>
                  {priceTL(
                    optionsItem.price_cents +
                    (optionsItem.variants?.find(v => v.id === selectedVariant)?.priceDiffCents ?? 0) +
                    (optionsItem.extras?.filter(e => selectedExtras.has(e.id)).reduce((s, e) => s + e.priceCents, 0) ?? 0)
                  )}
                </Text>
                <Pressable style={st.optionsConfirmBtn} onPress={confirmOptions}>
                  <Text style={st.optionsConfirmText}>Sepete Ekle</Text>
                </Pressable>
              </View>
            </>
          )}
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FAFAFA' },
  errorWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  errorEmoji: { fontSize: 52 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: '#1A1208' },
  errorBtn: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  errorBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  scroll: { paddingBottom: 32 },

  // ── Sticky Header
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(240,236,230,0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
  },
  stickyInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  stickyTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#1A1208' },
  stickyRating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stickyRatingStar: { fontSize: 14, color: '#EF9F27' },
  stickyRatingNum: { fontSize: 14, fontWeight: '700', color: '#1A1208' },

  // ── Floating buttons
  floatingBackWrap: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    zIndex: 5,
  },
  floatingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  floatingBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  floatingBtnIcon: { fontSize: 24, fontWeight: '700', color: '#1A1208', marginTop: -2 },
  floatingFavIcon: { fontSize: 20, marginTop: 1 },

  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F0EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { fontSize: 22, fontWeight: '700', color: '#1A1208', marginTop: -2 },

  // ── Hero Cover
  heroCover: {
    height: 200,
    width: SCREEN_W,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  heroEmoji: { fontSize: 72 },
  heroGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: 'transparent',
  },

  // ── Info Section
  infoSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F0ECE6',
  },
  sellerName: { fontSize: 24, fontWeight: '800', color: '#1A1208', marginBottom: 8 },

  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  ratingStarBig: { fontSize: 14, color: '#EF9F27' },
  ratingNumBig: { fontSize: 14, fontWeight: '800', color: '#1A1208' },
  ratingCountText: { fontSize: 13, color: '#8A7E72' },
  ratingDivider: { width: 1, height: 14, backgroundColor: '#E8E2DA' },
  verifiedText: { fontSize: 13, color: '#2E7D32', fontWeight: '600' },

  sellerBio: { fontSize: 14, color: '#6B5E50', lineHeight: 20, marginBottom: 14 },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F7F3EE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  chipAccent: { backgroundColor: '#E8F5E9' },
  chipIcon: { fontSize: 13 },
  chipLabel: { fontSize: 12, fontWeight: '600', color: '#6B5E50' },
  chipLabelAccent: { color: '#2E7D32' },

  // ── Menu Section
  menuSection: { paddingTop: 20, paddingHorizontal: 16 },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  menuHeading: { fontSize: 20, fontWeight: '800', color: '#1A1208' },
  menuCount: { fontSize: 13, color: '#A89A8A', fontWeight: '500' },
  menuList: { gap: 10 },
  catHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 4, paddingHorizontal: 4 },
  catHeaderText: { fontSize: 15, fontWeight: '800', color: '#1A1208' },
  catHeaderCount: { fontSize: 12, color: '#A89A8A', fontWeight: '500' },

  // ── Menu Card
  menuCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F0ECE6',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  menuCardDisabled: { opacity: 0.5 },
  menuLeft: {},
  menuEmoji: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  menuEmojiText: { fontSize: 28 },
  menuCenter: { flex: 1, gap: 3 },
  menuTitle: { fontSize: 15, fontWeight: '700', color: '#1A1208' },
  menuDesc: { fontSize: 12, color: '#8A7E72', lineHeight: 17 },
  menuTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  menuPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  menuPrice: { fontSize: 16, fontWeight: '800', color: colors.primary },
  badgePill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  optionsHint: { fontSize: 10, color: '#A89A8A', fontWeight: '500', fontStyle: 'italic' },
  menuRight: { alignItems: 'flex-end', flexShrink: 0 },

  // ── Add / Qty controls
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  addBtnPlus: { fontSize: 22, fontWeight: '700', color: '#fff', marginTop: -1 },
  soldOut: {
    backgroundColor: '#F5F0EA',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  soldOutText: { fontSize: 11, fontWeight: '600', color: '#A89A8A' },
  qtyControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F3EE',
    borderRadius: 12,
    gap: 4,
    padding: 4,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EDE8E2',
  },
  qtyBtnAdd: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  qtyBtnText: { fontSize: 18, fontWeight: '700', color: '#1A1208', lineHeight: 20 },
  qtyBtnAddText: { color: '#fff' },
  qtyNum: { fontSize: 15, fontWeight: '800', color: '#1A1208', minWidth: 24, textAlign: 'center' },

  // ── Empty
  emptyMenu: { alignItems: 'center', paddingVertical: 48 },
  emptyEmoji: { fontSize: 48 },
  emptyText: { fontSize: 14, color: '#A89A8A', marginTop: 12 },

  // ── About Section
  aboutSection: { paddingHorizontal: 16, paddingTop: 28, paddingBottom: 16 },
  aboutHeading: { fontSize: 18, fontWeight: '800', color: '#1A1208', marginBottom: 12 },
  aboutCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  aboutLabel: { fontSize: 13, color: '#8A7E72' },
  aboutValue: { fontSize: 13, fontWeight: '600', color: '#1A1208', textAlign: 'right', maxWidth: '55%' },
  aboutDivider: { height: 1, backgroundColor: '#F5F0EA' },

  // ── Cart Bar
  cartBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F0ECE6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
  cartBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  cartBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cartBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadgeText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  cartBarLabel: { fontSize: 12, color: '#8A7E72', fontWeight: '500' },
  cartBarPrice: { fontSize: 17, fontWeight: '800', color: '#1A1208' },
  cartBarBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  cartBarBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // ── Working Hours
  hoursSection: { paddingHorizontal: 16, paddingTop: 24 },
  hoursTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  hoursHeading: { fontSize: 18, fontWeight: '800', color: '#1A1208' },
  hoursToggle: { fontSize: 14, color: '#A89A8A' },
  hoursCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F0ECE6',
    gap: 2,
  },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  hoursRowToday: { backgroundColor: '#FFF5F2' },
  hoursDay: { fontSize: 13, fontWeight: '600', color: '#6B5E50', width: 90 },
  hoursDayToday: { color: colors.primary, fontWeight: '800' },
  hoursTime: { fontSize: 13, fontWeight: '600', color: '#1A1208' },
  hoursTimeClosed: { color: '#C62828' },
  hoursTimeToday: { color: colors.primary, fontWeight: '800' },
  hoursTodayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginLeft: 8,
  },

  // Reviews
  reviewsSection: { paddingHorizontal: 16, marginTop: 20, gap: 10 },
  reviewCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F0ECE6',
    padding: 14,
    gap: 10,
  },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FAF7F2',
    borderWidth: 1,
    borderColor: '#EDE8E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewAvatarText: { fontSize: 14, fontWeight: '700', color: '#6B5E50' },
  reviewName: { fontSize: 13, fontWeight: '700', color: '#1A1208' },
  reviewDate: { fontSize: 11, color: '#A89A8A' },
  reviewStars: { flexDirection: 'row', gap: 1 },
  reviewStar: { fontSize: 12, color: '#E8E2DA' },
  reviewStarActive: { color: '#EF9F27' },
  reviewComment: { fontSize: 13, color: '#6B5E50', lineHeight: 19 },

  // Options modal
  optionsCard: { backgroundColor: '#fff' },
  optionsInner: { padding: 20, paddingBottom: 34 },
  optionsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  optionsTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208', flex: 1, marginRight: 12 },
  optionsClose: { fontSize: 18, color: '#A89A8A', fontWeight: '700', padding: 4 },
  optionsDesc: { fontSize: 13, color: '#8A7E72', lineHeight: 19, marginBottom: 12 },
  optionsSection: { marginTop: 16 },
  optionsSectionTitle: { fontSize: 13, fontWeight: '700', color: '#6B5E50', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, marginBottom: 6, backgroundColor: '#FAF7F2', borderWidth: 1, borderColor: '#F0ECE6' },
  optionRowActive: { backgroundColor: '#FFF0EB', borderColor: colors.primary },
  optionRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#D0C8BC', alignItems: 'center', justifyContent: 'center' },
  optionRadioActive: { borderColor: colors.primary },
  optionRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  optionCheck: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#D0C8BC', alignItems: 'center', justifyContent: 'center' },
  optionCheckActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  optionCheckMark: { fontSize: 12, fontWeight: '900', color: '#fff' },
  optionLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1A1208' },
  optionLabelActive: { color: colors.primary, fontWeight: '700' },
  optionPrice: { fontSize: 13, fontWeight: '700', color: '#6B5E50' },
  optionsFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F0ECE6' },
  optionsTotal: { fontSize: 22, fontWeight: '900', color: '#1A1208' },
  optionsConfirmBtn: { backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14 },
  optionsConfirmText: { fontSize: 15, fontWeight: '800', color: '#fff' },

  // Rating summary
  ratingSummary: { flexDirection: 'row', backgroundColor: '#FAF7F2', borderRadius: 16, padding: 16, marginBottom: 14, gap: 20, borderWidth: 1, borderColor: '#F0ECE6' },
  ratingSummaryLeft: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  ratingSummaryNum: { fontSize: 36, fontWeight: '900', color: '#1A1208' },
  ratingSummaryStars: { flexDirection: 'row', gap: 2 },
  ratingSummaryCount: { fontSize: 11, color: '#A89A8A', fontWeight: '500', marginTop: 2 },
  ratingSummaryBars: { flex: 1, justifyContent: 'center', gap: 5 },
  ratingBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ratingBarLabel: { fontSize: 12, fontWeight: '700', color: '#A89A8A', width: 12, textAlign: 'center' },
  ratingBarTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#EDE8E2', overflow: 'hidden' },
  ratingBarFill: { height: '100%', borderRadius: 3, backgroundColor: '#EF9F27' },
});
