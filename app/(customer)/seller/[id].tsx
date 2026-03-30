import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { fetchSellerWithMenu, fetchReviews, type ReviewRow } from '@/lib/db';

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

// ─── Güven & Hijyen ──────────────────────────────────────────────────────────

type TrustInfo = {
  memberSince: string;
  totalOrders: number;
  repeatCustomerRate: number;
  hygieneScore: number;
  hasCertificate: boolean;
  certificateType: string;
  kitchenPhotos: number;
  lastInspection: string;
  packagingType: string;
};

const TRUST_DATA: Record<string, TrustInfo> = {
  'demo-1': { memberSince: '2024-03', totalOrders: 1847, repeatCustomerRate: 68, hygieneScore: 96, hasCertificate: true, certificateType: 'Gıda Üretim Sertifikası', kitchenPhotos: 4, lastInspection: '2026-02-15', packagingType: 'Termal çanta + Sızdırmaz kaplar' },
  'demo-2': { memberSince: '2024-06', totalOrders: 923, repeatCustomerRate: 72, hygieneScore: 94, hasCertificate: true, certificateType: 'Hijyen Belgesi', kitchenPhotos: 3, lastInspection: '2026-01-20', packagingType: 'Kraft kağıt + Cam kavanoz' },
  'demo-3': { memberSince: '2023-11', totalOrders: 2456, repeatCustomerRate: 75, hygieneScore: 98, hasCertificate: true, certificateType: 'Gıda Güvenliği Sertifikası', kitchenPhotos: 5, lastInspection: '2026-03-01', packagingType: 'Termal çanta + Vakumlu paket' },
  'demo-4': { memberSince: '2024-09', totalOrders: 612, repeatCustomerRate: 64, hygieneScore: 95, hasCertificate: true, certificateType: 'Pastane Üretim İzni', kitchenPhotos: 3, lastInspection: '2026-02-28', packagingType: 'Özel pasta kutusu + Soğuk zincir' },
  'demo-5': { memberSince: '2025-01', totalOrders: 438, repeatCustomerRate: 58, hygieneScore: 92, hasCertificate: false, certificateType: '', kitchenPhotos: 2, lastInspection: '2026-01-10', packagingType: 'Alüminyum folyo + Termal çanta' },
  'demo-6': { memberSince: '2024-04', totalOrders: 1205, repeatCustomerRate: 71, hygieneScore: 97, hasCertificate: true, certificateType: 'Gıda Üretim Sertifikası', kitchenPhotos: 4, lastInspection: '2026-03-10', packagingType: 'Kahvaltı sepeti + Sızdırmaz kaplar' },
};

// ─── Satıcı Hikayesi ─────────────────────────────────────────────────────────

type SellerStory = {
  story: string;
  expertise: string[];
  socialMedia: { instagram?: string; tiktok?: string; youtube?: string };
  motivation: string;
};

const SELLER_STORIES: Record<string, SellerStory> = {
  'demo-1': {
    story: '15 yıldır mutfakta olan bir ev aşçısıyım. Anneannemden öğrendiğim tarifleri, doğal ve taze malzemelerle sizlerle buluşturuyorum.',
    expertise: ['Türk Mutfağı', 'Ev Yemekleri', 'Çorbalar', 'Et Yemekleri'],
    socialMedia: { instagram: 'aysenin_mutfagi', tiktok: 'ayse_yemek' },
    motivation: 'Her tabağa sevgi katıyorum ❤️',
  },
  'demo-2': {
    story: 'Ege kökenli bir aileden geliyorum. Zeytinyağlı yemekler ve el açması börekler benim tutkum.',
    expertise: ['Ege Mutfağı', 'Zeytinyağlılar', 'Börekler', 'Vejetaryen'],
    socialMedia: { instagram: 'fatma_borek' },
    motivation: 'Doğal malzeme, geleneksel tarif 🌿',
  },
  'demo-3': {
    story: 'Trabzonluyum, İstanbul\'a taşındıktan sonra memleket lezzetlerimi burada yaşatmak istedim. Her balığı kendim seçerim.',
    expertise: ['Karadeniz Mutfağı', 'Balık', 'Hamsi', 'Mısır Unu'],
    socialMedia: { instagram: 'mehmet_karadeniz', youtube: 'MehmetUstaKaradeniz' },
    motivation: 'Karadeniz\'in tadını İstanbul\'a taşıyorum 🐟',
  },
  'demo-4': {
    story: 'Pastacılık eğitimi aldım ve 8 yıldır özel siparişlerle çalışıyorum. Her pasta bir sanat eseridir.',
    expertise: ['Pasta', 'Kurabiye', 'Tatlılar', 'Doğum Günü Özel'],
    socialMedia: { instagram: 'zeynep_pasta', tiktok: 'zeynep_tatli' },
    motivation: 'Her dilimde mutluluk 🎂',
  },
  'demo-5': {
    story: 'Mangal ve ızgara konusunda uzmanım. Günlük taze et alıp, kendi marine soslarımla hazırlıyorum.',
    expertise: ['Izgara', 'Mangal', 'Köfte', 'Et Yemekleri'],
    socialMedia: { instagram: 'huseyin_izgara' },
    motivation: 'Ateşle pişen lezzet 🔥',
  },
  'demo-6': {
    story: 'Her sabah 5\'te kalkıp taze kahvaltı hazırlıyorum. Köyden gelen malzemelerle gerçek bir Anadolu kahvaltısı sunuyorum.',
    expertise: ['Kahvaltı', 'Gözleme', 'Köy Ürünleri', 'Organik'],
    socialMedia: { instagram: 'elif_kahvalti', tiktok: 'elif_anne' },
    motivation: 'Güne güzel başlayın 🌅',
  },
};

// ─── Teslimat Detayları ──────────────────────────────────────────────────────

type DeliveryInfo = {
  zones: string[];
  fee: number; // cents
  freeDeliveryThreshold: number; // cents
  estimatedTime: string;
  packagingNote: string;
};

const DELIVERY_INFO: Record<string, DeliveryInfo> = {
  'demo-1': { zones: ['Kadıköy', 'Üsküdar', 'Ataşehir', 'Maltepe'], fee: 1500, freeDeliveryThreshold: 15000, estimatedTime: '25-35 dk', packagingNote: 'Yemekler termal çantada, sızdırmaz kaplarda teslim edilir.' },
  'demo-2': { zones: ['Beşiktaş', 'Şişli', 'Beyoğlu'], fee: 2000, freeDeliveryThreshold: 18000, estimatedTime: '30-40 dk', packagingNote: 'Kraft kağıt ambalajda, çevre dostu paketleme.' },
  'demo-3': { zones: ['Üsküdar', 'Kadıköy', 'Beykoz', 'Çekmeköy'], fee: 1000, freeDeliveryThreshold: 12000, estimatedTime: '20-30 dk', packagingNote: 'Vakumlu paketleme ile tazelik garantisi.' },
  'demo-4': { zones: ['Bakırköy', 'Bahçelievler', 'Zeytinburnu', 'Fatih'], fee: 2500, freeDeliveryThreshold: 20000, estimatedTime: '35-45 dk', packagingNote: 'Pastalar özel kutuda, soğuk zincirle teslim.' },
  'demo-5': { zones: ['Şişli', 'Kağıthane', 'Beyoğlu', 'Sarıyer'], fee: 1500, freeDeliveryThreshold: 15000, estimatedTime: '25-35 dk', packagingNote: 'Izgaralar alüminyum folyo ile sıcak teslim.' },
  'demo-6': { zones: ['Sarıyer', 'Beşiktaş', 'Eyüpsultan'], fee: 1000, freeDeliveryThreshold: 10000, estimatedTime: '20-30 dk', packagingNote: 'Kahvaltı sepetinde, özenle dizilmiş şekilde teslim.' },
};

// ─── Sipariş İstatistikleri ──────────────────────────────────────────────────

type OrderStats = {
  thisMonth: number;
  repeatCustomers: number;
  avgPrepTime: string;
  mostOrderedItem: string;
  mostOrderedCount: number;
  satisfactionRate: number;
};

const ORDER_STATS: Record<string, OrderStats> = {
  'demo-1': { thisMonth: 156, repeatCustomers: 84, avgPrepTime: '18 dk', mostOrderedItem: 'Kuru Fasulye + Pilav', mostOrderedCount: 423, satisfactionRate: 97 },
  'demo-2': { thisMonth: 89, repeatCustomers: 52, avgPrepTime: '22 dk', mostOrderedItem: 'Ispanaklı Börek', mostOrderedCount: 287, satisfactionRate: 95 },
  'demo-3': { thisMonth: 198, repeatCustomers: 112, avgPrepTime: '15 dk', mostOrderedItem: 'Hamsi Tava', mostOrderedCount: 567, satisfactionRate: 98 },
  'demo-4': { thisMonth: 67, repeatCustomers: 38, avgPrepTime: '30 dk', mostOrderedItem: 'Çikolatalı Yaş Pasta', mostOrderedCount: 189, satisfactionRate: 96 },
  'demo-5': { thisMonth: 45, repeatCustomers: 24, avgPrepTime: '20 dk', mostOrderedItem: 'Izgara Köfte', mostOrderedCount: 134, satisfactionRate: 93 },
  'demo-6': { thisMonth: 112, repeatCustomers: 68, avgPrepTime: '16 dk', mostOrderedItem: 'Serpme Kahvaltı', mostOrderedCount: 356, satisfactionRate: 97 },
};

// ─── Alerjen Bilgileri ───────────────────────────────────────────────────────

type AllergenInfo = {
  allergens: string[];
  calories?: number;
  isVegan?: boolean;
  isVegetarian?: boolean;
  isGlutenFree?: boolean;
};

const ALLERGEN_DATA: Record<string, AllergenInfo> = {
  'm1-1': { allergens: ['Gluten'], calories: 180, isVegetarian: true, isVegan: true },
  'm1-2': { allergens: ['Gluten'], calories: 450 },
  'm1-3': { allergens: ['Gluten', 'Yumurta'], calories: 520 },
  'm1-4': { allergens: [], calories: 120, isVegetarian: true, isVegan: true, isGlutenFree: true },
  'm2-1': { allergens: [], calories: 210, isVegetarian: true, isVegan: true, isGlutenFree: true },
  'm2-2': { allergens: ['Gluten', 'Süt'], calories: 380, isVegetarian: true },
  'm2-3': { allergens: [], calories: 240, isVegetarian: true, isVegan: true },
  'm3-1': { allergens: ['Balık', 'Gluten'], calories: 350 },
  'm3-2': { allergens: ['Süt', 'Gluten'], calories: 420, isVegetarian: true },
  'm3-3': { allergens: ['Gluten'], calories: 200, isVegetarian: true, isVegan: true },
  'm3-4': { allergens: [], calories: 160, isVegetarian: true, isVegan: true, isGlutenFree: true },
  'm4-1': { allergens: ['Süt', 'Yumurta', 'Gluten'], calories: 480 },
  'm4-2': { allergens: ['Süt', 'Yumurta', 'Gluten', 'Fındık'], calories: 320 },
  'm4-3': { allergens: ['Süt', 'Yumurta'], calories: 280 },
  'm5-1': { allergens: [], calories: 450, isGlutenFree: true },
  'm5-2': { allergens: [], calories: 380, isGlutenFree: true },
  'm5-3': { allergens: [], calories: 620, isGlutenFree: true },
  'm6-1': { allergens: ['Süt', 'Yumurta', 'Gluten', 'Fındık'], calories: 850 },
  'm6-2': { allergens: ['Gluten', 'Süt'], calories: 320, isVegetarian: true },
  'm6-3': { allergens: ['Yumurta'], calories: 280, isGlutenFree: true },
};

// ─── Stok Durumu ─────────────────────────────────────────────────────────────

const STOCK_STATUS: Record<string, { dailyLimit: number; soldToday: number }> = {
  'm1-1': { dailyLimit: 30, soldToday: 12 },
  'm1-2': { dailyLimit: 25, soldToday: 22 },
  'm1-3': { dailyLimit: 20, soldToday: 8 },
  'm1-4': { dailyLimit: 40, soldToday: 15 },
  'm2-1': { dailyLimit: 15, soldToday: 14 },
  'm2-2': { dailyLimit: 10, soldToday: 10 },
  'm2-3': { dailyLimit: 20, soldToday: 5 },
  'm3-1': { dailyLimit: 35, soldToday: 28 },
  'm3-2': { dailyLimit: 20, soldToday: 11 },
  'm3-3': { dailyLimit: 50, soldToday: 20 },
  'm3-4': { dailyLimit: 25, soldToday: 3 },
  'm4-1': { dailyLimit: 8, soldToday: 6 },
  'm4-2': { dailyLimit: 12, soldToday: 4 },
  'm4-3': { dailyLimit: 15, soldToday: 9 },
  'm5-1': { dailyLimit: 30, soldToday: 18 },
  'm5-2': { dailyLimit: 20, soldToday: 12 },
  'm5-3': { dailyLimit: 10, soldToday: 7 },
  'm6-1': { dailyLimit: 12, soldToday: 10 },
  'm6-2': { dailyLimit: 40, soldToday: 25 },
  'm6-3': { dailyLimit: 30, soldToday: 14 },
};

// ─── Fotoğraflı Yorumlar ────────────────────────────────────────────────────

type PhotoReviewDemo = {
  id: string;
  name: string;
  rating: number;
  date: string;
  comment: string;
  photoUri?: string;
  helpfulCount: number;
  menuItem?: string;
  sellerReply?: string;
};

const PHOTO_REVIEWS: Record<string, PhotoReviewDemo[]> = {
  'demo-1': [
    { id: 'pr1', name: 'Mehmet A.', rating: 5, date: '2 gün önce', comment: 'Kuru fasulye muhteşemdi, tam ev yemeği tadında. Kesinlikle tekrar sipariş vereceğim.', helpfulCount: 12, menuItem: 'Kuru Fasulye + Pilav', sellerReply: 'Çok teşekkürler Mehmet Bey! Afiyet olsun 🙏' },
    { id: 'pr2', name: 'Zeynep K.', rating: 4, date: '5 gün önce', comment: 'Çorba çok lezzetliydi ama teslimat biraz geç geldi.', helpfulCount: 5, menuItem: 'Mercimek Çorbası', sellerReply: 'Geri bildiriminiz için teşekkürler, teslimat süresini iyileştirmeye çalışıyoruz.' },
    { id: 'pr3', name: 'Ali B.', rating: 5, date: '1 hafta önce', comment: 'Her şey mükemmel, porsiyonlar büyük ve lezzetli. Paketleme de çok özenliydi.', helpfulCount: 8 },
    { id: 'pr4', name: 'Seda M.', rating: 5, date: '2 hafta önce', comment: 'İzmir köfte tarifi harika, anneanneminkinden bile güzel!', helpfulCount: 15, menuItem: 'İzmir Köfte' },
  ],
  'demo-2': [
    { id: 'pr1', name: 'Fatma Y.', rating: 5, date: '1 gün önce', comment: 'Börekler el açması, harika bir lezzet!', helpfulCount: 9, menuItem: 'Ispanaklı Börek', sellerReply: 'Afiyet olsun Fatma Hanım! 🥐' },
    { id: 'pr2', name: 'Hasan T.', rating: 4, date: '3 gün önce', comment: 'Zeytinyağlılar çok güzel, ama biraz yağlı geldi.', helpfulCount: 3 },
    { id: 'pr3', name: 'Derya S.', rating: 5, date: '1 hafta önce', comment: 'Dolmalar muhteşem, fıstıklı yaprak sarma bambaşka!', helpfulCount: 7, menuItem: 'Zeytinyağlı Dolma' },
  ],
  'demo-3': [
    { id: 'pr1', name: 'Ayşe D.', rating: 5, date: '1 gün önce', comment: 'Hamsi tava ve kuymak inanılmazdı. Karadeniz lezzetini İstanbul\'a taşımışlar.', helpfulCount: 18, menuItem: 'Hamsi Tava', sellerReply: 'Teşekkürler! Memleket lezzetleri için buradayız 🐟' },
    { id: 'pr2', name: 'Can M.', rating: 5, date: '4 gün önce', comment: 'Mısır ekmeği anneannemin yaptığı gibi!', helpfulCount: 11, menuItem: 'Mısır Ekmeği' },
    { id: 'pr3', name: 'Elif S.', rating: 4, date: '1 hafta önce', comment: 'Genel olarak çok güzel ama porsiyon biraz küçük.', helpfulCount: 4 },
    { id: 'pr4', name: 'Burak K.', rating: 5, date: '2 hafta önce', comment: 'En iyi Karadeniz mutfağı, sürekli sipariş veriyorum.', helpfulCount: 22 },
  ],
  'demo-4': [
    { id: 'pr1', name: 'Selin A.', rating: 5, date: '2 gün önce', comment: 'Çikolatalı pasta muhteşemdi, doğum günü için sipariş verdim herkes bayıldı.', helpfulCount: 14, menuItem: 'Çikolatalı Yaş Pasta', sellerReply: 'Nice mutlu doğum günlerine! 🎂' },
    { id: 'pr2', name: 'Murat K.', rating: 4, date: '1 hafta önce', comment: 'Tatlılar güzel ama fiyatlar biraz yüksek.', helpfulCount: 6 },
  ],
  'demo-5': [
    { id: 'pr1', name: 'Oğuz B.', rating: 4, date: '3 gün önce', comment: 'Köfteler çok lezzetli, ızgara tam kıvamında.', helpfulCount: 5, menuItem: 'Izgara Köfte' },
    { id: 'pr2', name: 'Derya N.', rating: 5, date: '1 hafta önce', comment: 'Tavuk şiş bayıldım, marine muhteşem.', helpfulCount: 8, menuItem: 'Tavuk Şiş', sellerReply: 'Teşekkür ederiz! 🔥' },
  ],
  'demo-6': [
    { id: 'pr1', name: 'Gül T.', rating: 5, date: '1 gün önce', comment: 'Serpme kahvaltı harikaydı, her şey taptaze. Reçeller ev yapımı.', helpfulCount: 16, menuItem: 'Serpme Kahvaltı', sellerReply: 'Afiyet olsun! Her sabah taze hazırlıyoruz 🌅' },
    { id: 'pr2', name: 'Emre Y.', rating: 5, date: '3 gün önce', comment: 'Gözlemeler harika, köy kahvaltısı tam istediğim gibi.', helpfulCount: 10, menuItem: 'Gözleme' },
    { id: 'pr3', name: 'Nisa K.', rating: 4, date: '1 hafta önce', comment: 'Güzel ama kahvaltı saatleri biraz dar.', helpfulCount: 4 },
  ],
};

// ─── Kampanya & Fırsatlar ────────────────────────────────────────────────────

type Campaign = {
  id: string;
  type: 'discount' | 'combo' | 'free_delivery' | 'first_order' | 'loyalty';
  title: string;
  description: string;
  badge: string;
  color: string;
  bgColor: string;
  validUntil?: string;
};

const CAMPAIGNS: Record<string, Campaign[]> = {
  'demo-1': [
    { id: 'c1', type: 'first_order', title: 'İlk Siparişe %15 İndirim', description: 'İlk siparişinize özel hoş geldin indirimi!', badge: '🎉', color: '#E65100', bgColor: '#FFF3E0', validUntil: '30 Nisan' },
    { id: 'c2', type: 'combo', title: 'Çorba + Ana Yemek Kombo', description: 'Herhangi bir çorba + ana yemek alana ₺10 indirim', badge: '🍲', color: '#2E7D32', bgColor: '#E8F5E9' },
    { id: 'c3', type: 'free_delivery', title: '₺150 Üzeri Ücretsiz Teslimat', description: '₺150 ve üzeri siparişlerde teslimat bizden!', badge: '🚗', color: '#1565C0', bgColor: '#E3F2FD' },
  ],
  'demo-2': [
    { id: 'c1', type: 'first_order', title: 'İlk Siparişe %10 İndirim', description: 'Hoş geldin hediyeniz!', badge: '🎉', color: '#E65100', bgColor: '#FFF3E0' },
    { id: 'c2', type: 'combo', title: '2 Zeytinyağlı Al 3. Bedava', description: '2 zeytinyağlı yemek al, 3. bedava!', badge: '🥬', color: '#2E7D32', bgColor: '#E8F5E9' },
  ],
  'demo-3': [
    { id: 'c1', type: 'discount', title: 'Hafta Sonu %20 İndirim', description: 'Cumartesi ve Pazar günleri tüm menüde geçerli', badge: '🎊', color: '#6A1B9A', bgColor: '#F3E5F5', validUntil: 'Her hafta sonu' },
    { id: 'c2', type: 'loyalty', title: '5 Sipariş Ver 1 Bedava', description: '5 sipariş tamamla, 6. sipariş bizden!', badge: '⭐', color: '#EF9F27', bgColor: '#FFF8E1' },
    { id: 'c3', type: 'free_delivery', title: 'Ücretsiz Teslimat', description: '₺120 üzeri siparişlerde teslimat ücretsiz', badge: '🚗', color: '#1565C0', bgColor: '#E3F2FD' },
  ],
  'demo-4': [
    { id: 'c1', type: 'combo', title: 'Pasta + Kurabiye Seti', description: 'Herhangi bir pasta alana kurabiye kutusu %50 indirimli', badge: '🎂', color: '#C2185B', bgColor: '#FCE4EC' },
  ],
  'demo-5': [
    { id: 'c1', type: 'first_order', title: 'İlk Siparişe Ücretsiz Teslimat', description: 'İlk siparişinizde teslimat bizden!', badge: '🎉', color: '#E65100', bgColor: '#FFF3E0' },
    { id: 'c2', type: 'combo', title: 'Karışık Izgara Fırsatı', description: 'Karışık ızgara tabağı + içecek sadece ₺200', badge: '🔥', color: '#C62828', bgColor: '#FFEBEE' },
  ],
  'demo-6': [
    { id: 'c1', type: 'discount', title: 'Erken Kuş İndirimi', description: '09:00 öncesi siparişlerde %10 indirim', badge: '🌅', color: '#E65100', bgColor: '#FFF3E0' },
    { id: 'c2', type: 'free_delivery', title: 'Ücretsiz Teslimat', description: '₺100 üzeri siparişlerde teslimat bedava', badge: '🚗', color: '#1565C0', bgColor: '#E3F2FD' },
    { id: 'c3', type: 'loyalty', title: '3 Kahvaltı Al 1 Bedava', description: '3 kahvaltı siparişi ver, 4. bizden!', badge: '☕', color: '#4E342E', bgColor: '#EFEBE9' },
  ],
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
        {/* Alerjen & Kalori etiketleri */}
        {(() => {
          const info = ALLERGEN_DATA[item.id];
          const stock = STOCK_STATUS[item.id];
          if (!info && !stock) return null;
          return (
            <View style={st.menuTagsRow}>
              {info?.calories && (
                <View style={st.calorieBadge}>
                  <Text style={st.calorieBadgeText}>{info.calories} kcal</Text>
                </View>
              )}
              {info?.isVegetarian && (
                <View style={[st.dietBadge, { backgroundColor: '#E8F5E9' }]}>
                  <Text style={[st.dietBadgeText, { color: '#2E7D32' }]}>🌱 Vejetaryen</Text>
                </View>
              )}
              {info?.isVegan && (
                <View style={[st.dietBadge, { backgroundColor: '#F1F8E9' }]}>
                  <Text style={[st.dietBadgeText, { color: '#33691E' }]}>🌿 Vegan</Text>
                </View>
              )}
              {info?.isGlutenFree && (
                <View style={[st.dietBadge, { backgroundColor: '#FFF3E0' }]}>
                  <Text style={[st.dietBadgeText, { color: '#E65100' }]}>Glutensiz</Text>
                </View>
              )}
              {info?.allergens && info.allergens.length > 0 && (
                <View style={st.allergenBadge}>
                  <Text style={st.allergenBadgeText}>⚠️ {info.allergens.join(', ')}</Text>
                </View>
              )}
              {stock && (
                <View style={[st.stockBadge, stock.soldToday >= stock.dailyLimit && st.stockBadgeSoldOut]}>
                  <Text style={[st.stockBadgeText, stock.soldToday >= stock.dailyLimit && st.stockBadgeTextSoldOut]}>
                    {stock.soldToday >= stock.dailyLimit ? 'Tükendi' : `${stock.dailyLimit - stock.soldToday} kaldı`}
                  </Text>
                </View>
              )}
            </View>
          );
        })()}
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
  const [isFollowing, setIsFollowing] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [showDeliveryZones, setShowDeliveryZones] = useState(false);
  const [showAllergens, setShowAllergens] = useState<string | null>(null);
  const [helpfulReviews, setHelpfulReviews] = useState<Set<string>>(new Set());
  const [dbReviews, setDbReviews] = useState<ReviewRow[]>([]);
  const scrollY = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(1)).current;
  const optionsSheetRef = useRef<BottomSheet>(null);
  const messageSheetRef = useRef<BottomSheet>(null);
  const optionsSnapPoints = useMemo(() => ['55%', '80%'], []);
  const messageSnapPoints = useMemo(() => ['45%'], []);

  const isFav = isFavorite(id ?? '');

  useEffect(() => {
    if (!id) return;
    addRecent(id);

    // Demo seller? Use hardcoded data
    if (id.startsWith('demo-')) {
      setSeller(DEMO_SELLERS[id] ?? null);
      setMenuItems(DEMO_MENUS[id] ?? []);
      setLoading(false);
      return;
    }

    // Real seller: try Supabase, fallback to demo
    (async () => {
      try {
        const result = await fetchSellerWithMenu(id);
        if (result) {
          const s: Seller & { deliveryTime: string; minOrder: number } = {
            id: result.id,
            user_id: result.user_id,
            display_name: result.display_name,
            bio: result.bio,
            city: result.city,
            district: result.district,
            address_line: result.address_line,
            latitude: result.latitude ? Number(result.latitude) : null,
            longitude: result.longitude ? Number(result.longitude) : null,
            rating_avg: Number(result.rating_avg) || 0,
            rating_count: result.rating_count,
            is_active: result.is_active,
            created_at: result.created_at,
            updated_at: result.updated_at,
            deliveryTime: '25-35',
            minOrder: 5000,
          };
          setSeller(s);
          const items: MenuItem[] = result.menu_items.map(m => ({
            id: m.id,
            seller_id: m.seller_id,
            title: m.title,
            description: m.description,
            price_cents: m.price_cents,
            currency: m.currency,
            image_url: m.image_url,
            is_available: m.is_available,
            category: m.category ?? undefined,
            created_at: m.created_at,
            updated_at: m.updated_at,
          }));
          setMenuItems(items);

          // Fetch reviews from Supabase
          try {
            const reviews = await fetchReviews(id);
            setDbReviews(reviews);
          } catch {}
        } else {
          setSeller(null);
        }
      } catch {
        setSeller(DEMO_SELLERS[id] ?? null);
        setMenuItems(DEMO_MENUS[id] ?? []);
      } finally {
        setLoading(false);
      }
    })();
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

  // Merge reviews: use Supabase reviews for real sellers, demo reviews for demo sellers
  const displayReviews: PhotoReviewDemo[] = useMemo((): PhotoReviewDemo[] => {
    const demoRevs: PhotoReviewDemo[] = PHOTO_REVIEWS[id!] ?? [];
    if (dbReviews.length > 0) {
      const supaReviews: PhotoReviewDemo[] = dbReviews.map((r: ReviewRow) => ({
        id: r.id,
        name: 'Müşteri',
        rating: r.rating,
        date: (() => {
          const diffMs = Date.now() - new Date(r.created_at).getTime();
          const diffDay = Math.floor(diffMs / 86400000);
          if (diffDay === 0) return 'Bugün';
          if (diffDay === 1) return 'Dün';
          if (diffDay < 7) return `${diffDay} gün önce`;
          if (diffDay < 30) return `${Math.floor(diffDay / 7)} hafta önce`;
          return new Date(r.created_at).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
        })(),
        comment: r.comment ?? '',
        helpfulCount: r.helpful_count,
        menuItem: r.menu_item_title ?? undefined,
        sellerReply: r.seller_reply ?? undefined,
      }));
      return [...supaReviews, ...demoRevs];
    }
    return demoRevs;
  }, [id, dbReviews]);

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

          {/* Takip Et + Mesaj Gönder butonları */}
          <View style={st.actionBtnsRow}>
            <Pressable
              style={[st.followBtn, isFollowing && st.followBtnActive]}
              onPress={() => setIsFollowing(!isFollowing)}
            >
              <Text style={[st.followBtnText, isFollowing && st.followBtnTextActive]}>
                {isFollowing ? '✓ Takip Ediliyor' : '+ Takip Et'}
              </Text>
            </Pressable>
            <Pressable
              style={st.messageBtnInline}
              onPress={() => messageSheetRef.current?.snapToIndex(0)}
            >
              <Text style={st.messageBtnInlineText}>💬 Mesaj Gönder</Text>
            </Pressable>
            <Pressable
              style={st.customOrderBtn}
              onPress={() => {
                setMessageText('Merhaba, özel bir sipariş vermek istiyorum: ');
                messageSheetRef.current?.snapToIndex(0);
              }}
            >
              <Text style={st.customOrderBtnText}>📋 Özel Sipariş</Text>
            </Pressable>
          </View>
        </View>

        {/* ═══ KAMPANYALAR ═══ */}
        {(CAMPAIGNS[id!] ?? []).length > 0 && (
          <View style={st.campaignsSection}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.campaignsScroll}>
              {(CAMPAIGNS[id!] ?? []).map(camp => (
                <View key={camp.id} style={[st.campaignCard, { backgroundColor: camp.bgColor, borderColor: camp.color + '30' }]}>
                  <View style={st.campaignTop}>
                    <Text style={st.campaignBadge}>{camp.badge}</Text>
                    <View style={[st.campaignTypePill, { backgroundColor: camp.color + '20' }]}>
                      <Text style={[st.campaignTypeText, { color: camp.color }]}>
                        {camp.type === 'first_order' ? 'Hoş Geldin' : camp.type === 'combo' ? 'Kombo' : camp.type === 'free_delivery' ? 'Teslimat' : camp.type === 'loyalty' ? 'Sadakat' : 'İndirim'}
                      </Text>
                    </View>
                  </View>
                  <Text style={[st.campaignTitle, { color: camp.color }]}>{camp.title}</Text>
                  <Text style={st.campaignDesc}>{camp.description}</Text>
                  {camp.validUntil && <Text style={[st.campaignValid, { color: camp.color }]}>Geçerlilik: {camp.validUntil}</Text>}
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ═══ GÜVEN & İSTATİSTİKLER ═══ */}
        {TRUST_DATA[id!] && (
          <View style={[st.trustSection, { backgroundColor: t.surface }]}>
            <Text style={[st.sectionTitle, { color: t.text }]}>Güven & İstatistikler</Text>

            {/* İstatistik kartları */}
            <View style={st.statsGrid}>
              <View style={[st.statCard, { backgroundColor: '#FFF8E1' }]}>
                <Text style={st.statEmoji}>📦</Text>
                <Text style={st.statNum}>{TRUST_DATA[id!].totalOrders.toLocaleString('tr-TR')}</Text>
                <Text style={st.statLabel}>Toplam Sipariş</Text>
              </View>
              <View style={[st.statCard, { backgroundColor: '#E8F5E9' }]}>
                <Text style={st.statEmoji}>🔄</Text>
                <Text style={st.statNum}>%{TRUST_DATA[id!].repeatCustomerRate}</Text>
                <Text style={st.statLabel}>Tekrar Müşteri</Text>
              </View>
              <View style={[st.statCard, { backgroundColor: '#E3F2FD' }]}>
                <Text style={st.statEmoji}>🧼</Text>
                <Text style={st.statNum}>{TRUST_DATA[id!].hygieneScore}/100</Text>
                <Text style={st.statLabel}>Hijyen Skoru</Text>
              </View>
              <View style={[st.statCard, { backgroundColor: '#F3E5F5' }]}>
                <Text style={st.statEmoji}>⚡</Text>
                <Text style={st.statNum}>{ORDER_STATS[id!]?.avgPrepTime ?? '—'}</Text>
                <Text style={st.statLabel}>Ort. Hazırlık</Text>
              </View>
            </View>

            {/* Ay istatistikleri */}
            {ORDER_STATS[id!] && (
              <View style={st.monthStatsRow}>
                <View style={st.monthStatItem}>
                  <Text style={st.monthStatNum}>{ORDER_STATS[id!].thisMonth}</Text>
                  <Text style={st.monthStatLabel}>Bu Ay Sipariş</Text>
                </View>
                <View style={st.monthStatDivider} />
                <View style={st.monthStatItem}>
                  <Text style={st.monthStatNum}>{ORDER_STATS[id!].repeatCustomers}</Text>
                  <Text style={st.monthStatLabel}>Tekrar Müşteri</Text>
                </View>
                <View style={st.monthStatDivider} />
                <View style={st.monthStatItem}>
                  <Text style={st.monthStatNum}>%{ORDER_STATS[id!].satisfactionRate}</Text>
                  <Text style={st.monthStatLabel}>Memnuniyet</Text>
                </View>
              </View>
            )}

            {/* En popüler ürün */}
            {ORDER_STATS[id!]?.mostOrderedItem && (
              <View style={st.popularItemCard}>
                <Text style={st.popularItemIcon}>🏆</Text>
                <View style={{ flex: 1 }}>
                  <Text style={st.popularItemLabel}>En Çok Sipariş Edilen</Text>
                  <Text style={st.popularItemName}>{ORDER_STATS[id!].mostOrderedItem}</Text>
                </View>
                <Text style={st.popularItemCount}>{ORDER_STATS[id!].mostOrderedCount}x</Text>
              </View>
            )}

            {/* Sertifika & Hijyen */}
            <View style={st.trustBadgesRow}>
              {TRUST_DATA[id!].hasCertificate && (
                <View style={st.trustBadge}>
                  <Text style={st.trustBadgeIcon}>📜</Text>
                  <Text style={st.trustBadgeText}>{TRUST_DATA[id!].certificateType}</Text>
                </View>
              )}
              <View style={st.trustBadge}>
                <Text style={st.trustBadgeIcon}>📅</Text>
                <Text style={st.trustBadgeText}>
                  {(() => {
                    const d = TRUST_DATA[id!].memberSince.split('-');
                    const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
                    return `${months[parseInt(d[1], 10) - 1]} ${d[0]}'dan beri aktif`;
                  })()}
                </Text>
              </View>
              <View style={st.trustBadge}>
                <Text style={st.trustBadgeIcon}>🔍</Text>
                <Text style={st.trustBadgeText}>Son denetim: {TRUST_DATA[id!].lastInspection}</Text>
              </View>
            </View>
          </View>
        )}

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

        {/* ═══ YORUMLAR (GELİŞTİRİLMİŞ) ═══ */}
        {displayReviews.length > 0 && (
          <View style={[st.reviewsSection, { backgroundColor: t.surface }]}>
            <View style={st.menuHeader}>
              <Text style={[st.menuHeading, { color: t.text }]}>Değerlendirmeler</Text>
              <Text style={[st.menuCount, { color: t.textMuted }]}>{displayReviews.length} yorum</Text>
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
                    const reviews = displayReviews;
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

            {/* En beğenilen yorum highlight */}
            {(() => {
              const reviews = displayReviews;
              const topReview = [...reviews].sort((a, b) => b.helpfulCount - a.helpfulCount)[0];
              if (!topReview || topReview.helpfulCount < 5) return null;
              return (
                <View style={st.topReviewCard}>
                  <View style={st.topReviewBadge}>
                    <Text style={st.topReviewBadgeText}>⭐ En Beğenilen Yorum</Text>
                  </View>
                  <View style={st.reviewTop}>
                    <View style={[st.reviewAvatar, { backgroundColor: '#FFF8E1', borderColor: '#EF9F27' }]}>
                      <Text style={st.reviewAvatarText}>{topReview.name.charAt(0)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[st.reviewName, { color: t.text }]}>{topReview.name}</Text>
                      <View style={st.reviewStars}>
                        {[1, 2, 3, 4, 5].map(s => (
                          <Text key={s} style={[st.reviewStar, s <= topReview.rating && st.reviewStarActive]}>★</Text>
                        ))}
                      </View>
                    </View>
                    <Text style={st.helpfulCountHighlight}>👍 {topReview.helpfulCount}</Text>
                  </View>
                  <Text style={[st.reviewComment, { color: t.textSecondary }]}>{topReview.comment}</Text>
                  {topReview.menuItem && (
                    <View style={st.reviewMenuTag}>
                      <Text style={st.reviewMenuTagText}>🍽️ {topReview.menuItem}</Text>
                    </View>
                  )}
                </View>
              );
            })()}

            {/* Tüm yorumlar */}
            {displayReviews.map(rev => (
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

                {/* Sipariş edilen ürün */}
                {rev.menuItem && (
                  <View style={st.reviewMenuTag}>
                    <Text style={st.reviewMenuTagText}>🍽️ {rev.menuItem}</Text>
                  </View>
                )}

                <Text style={[st.reviewComment, { color: t.textSecondary }]}>{rev.comment}</Text>

                {/* Satıcı Cevabı */}
                {rev.sellerReply && (
                  <View style={st.sellerReplyCard}>
                    <View style={st.sellerReplyHeader}>
                      <Text style={st.sellerReplyIcon}>💬</Text>
                      <Text style={st.sellerReplyLabel}>Satıcı Yanıtı</Text>
                    </View>
                    <Text style={st.sellerReplyText}>{rev.sellerReply}</Text>
                  </View>
                )}

                {/* Faydalı butonu */}
                <View style={st.reviewActions}>
                  <Pressable
                    style={[st.helpfulBtn, helpfulReviews.has(rev.id) && st.helpfulBtnActive]}
                    onPress={() => {
                      setHelpfulReviews(prev => {
                        const next = new Set(prev);
                        if (next.has(rev.id)) next.delete(rev.id);
                        else next.add(rev.id);
                        return next;
                      });
                    }}
                  >
                    <Text style={[st.helpfulBtnText, helpfulReviews.has(rev.id) && st.helpfulBtnTextActive]}>
                      👍 Faydalı ({rev.helpfulCount + (helpfulReviews.has(rev.id) ? 1 : 0)})
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ═══ TESLİMAT DETAYLARI ═══ */}
        {DELIVERY_INFO[id!] && (
          <View style={[st.deliverySection, { backgroundColor: t.surface }]}>
            <Text style={[st.sectionTitle, { color: t.text }]}>Teslimat Bilgileri</Text>

            <View style={[st.deliveryCard, { backgroundColor: t.background, borderColor: t.surfaceBorder }]}>
              <View style={st.deliveryRow}>
                <Text style={st.deliveryIcon}>🚗</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[st.deliveryLabel, { color: t.textMuted }]}>Teslimat Süresi</Text>
                  <Text style={[st.deliveryValue, { color: t.text }]}>{DELIVERY_INFO[id!].estimatedTime}</Text>
                </View>
              </View>

              <View style={st.deliveryDivider} />

              <View style={st.deliveryRow}>
                <Text style={st.deliveryIcon}>💰</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[st.deliveryLabel, { color: t.textMuted }]}>Teslimat Ücreti</Text>
                  <Text style={[st.deliveryValue, { color: t.text }]}>
                    {priceTL(DELIVERY_INFO[id!].fee)}
                    <Text style={st.deliveryFreeNote}>
                      {' '}({priceTL(DELIVERY_INFO[id!].freeDeliveryThreshold)} üzeri ücretsiz)
                    </Text>
                  </Text>
                </View>
              </View>

              <View style={st.deliveryDivider} />

              <View style={st.deliveryRow}>
                <Text style={st.deliveryIcon}>📦</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[st.deliveryLabel, { color: t.textMuted }]}>Paketleme</Text>
                  <Text style={[st.deliveryValue, { color: t.text }]}>{DELIVERY_INFO[id!].packagingNote}</Text>
                </View>
              </View>

              <View style={st.deliveryDivider} />

              <Pressable
                style={st.deliveryRow}
                onPress={() => setShowDeliveryZones(!showDeliveryZones)}
              >
                <Text style={st.deliveryIcon}>📍</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[st.deliveryLabel, { color: t.textMuted }]}>Teslimat Bölgeleri</Text>
                  {showDeliveryZones ? (
                    <View style={st.deliveryZonesGrid}>
                      {DELIVERY_INFO[id!].zones.map(zone => (
                        <View key={zone} style={st.deliveryZoneChip}>
                          <Text style={st.deliveryZoneText}>{zone}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={[st.deliveryValue, { color: colors.primary }]}>
                      {DELIVERY_INFO[id!].zones.length} bölge — görmek için dokun
                    </Text>
                  )}
                </View>
              </Pressable>
            </View>
          </View>
        )}

        {/* ═══ SATICI HİKAYESİ ═══ */}
        {SELLER_STORIES[id!] && (
          <View style={[st.storySection, { backgroundColor: t.surface }]}>
            <Text style={[st.sectionTitle, { color: t.text }]}>Beni Tanıyın</Text>

            <View style={st.storyCard}>
              <Text style={st.storyMotivation}>"{SELLER_STORIES[id!].motivation}"</Text>
              <Text style={[st.storyText, { color: t.textSecondary }]}>{SELLER_STORIES[id!].story}</Text>

              {/* Uzmanlık etiketleri */}
              <View style={st.expertiseRow}>
                {SELLER_STORIES[id!].expertise.map(tag => (
                  <View key={tag} style={st.expertiseTag}>
                    <Text style={st.expertiseTagText}>{tag}</Text>
                  </View>
                ))}
              </View>

              {/* Sosyal medya linkleri */}
              <View style={st.socialRow}>
                {SELLER_STORIES[id!].socialMedia.instagram && (
                  <Pressable
                    style={st.socialBtn}
                    onPress={() => Linking.openURL(`https://instagram.com/${SELLER_STORIES[id!].socialMedia.instagram}`)}
                  >
                    <Text style={st.socialBtnText}>📸 Instagram</Text>
                  </Pressable>
                )}
                {SELLER_STORIES[id!].socialMedia.tiktok && (
                  <Pressable
                    style={st.socialBtn}
                    onPress={() => Linking.openURL(`https://tiktok.com/@${SELLER_STORIES[id!].socialMedia.tiktok}`)}
                  >
                    <Text style={st.socialBtnText}>🎵 TikTok</Text>
                  </Pressable>
                )}
                {SELLER_STORIES[id!].socialMedia.youtube && (
                  <Pressable
                    style={st.socialBtn}
                    onPress={() => Linking.openURL(`https://youtube.com/@${SELLER_STORIES[id!].socialMedia.youtube}`)}
                  >
                    <Text style={st.socialBtnText}>▶️ YouTube</Text>
                  </Pressable>
                )}
              </View>
            </View>
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
            {TRUST_DATA[id!] && (
              <>
                <View style={st.aboutDivider} />
                <View style={st.aboutRow}>
                  <Text style={st.aboutLabel}>📦 Paketleme</Text>
                  <Text style={st.aboutValue}>{TRUST_DATA[id!].packagingType}</Text>
                </View>
              </>
            )}
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

      {/* ═══ MESAJ BOTTOM SHEET ═══ */}
      <BottomSheet
        ref={messageSheetRef}
        index={-1}
        snapPoints={messageSnapPoints}
        enablePanDownToClose
        backdropComponent={(props) => (
          <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
        )}
        handleIndicatorStyle={{ backgroundColor: '#D0C8BC', width: 40 }}
        backgroundStyle={[st.optionsCard, { backgroundColor: t.surface }]}
      >
        <BottomSheetView style={st.optionsInner}>
          <View style={st.optionsHeader}>
            <Text style={st.optionsTitle}>💬 Mesaj Gönder</Text>
            <Pressable onPress={() => messageSheetRef.current?.close()} hitSlop={8}>
              <Text style={st.optionsClose}>✕</Text>
            </Pressable>
          </View>
          <Text style={[st.msgSubtitle, { color: t.textMuted }]}>
            Satıcıya soru sorun veya özel sipariş isteyin
          </Text>
          <TextInput
            style={[st.msgInput, { backgroundColor: t.background, color: t.text, borderColor: t.surfaceBorder }]}
            placeholder="Mesajınızı yazın..."
            placeholderTextColor={t.textMuted}
            value={messageText}
            onChangeText={setMessageText}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
          <View style={st.msgQuickBtns}>
            <Pressable style={st.msgQuickBtn} onPress={() => setMessageText('Bu yemeği ne zaman hazırlayabilirsiniz?')}>
              <Text style={st.msgQuickBtnText}>🕐 Ne zaman hazır?</Text>
            </Pressable>
            <Pressable style={st.msgQuickBtn} onPress={() => setMessageText('Alerjen içermeyen seçenekleriniz var mı?')}>
              <Text style={st.msgQuickBtnText}>⚠️ Alerjen bilgisi</Text>
            </Pressable>
            <Pressable style={st.msgQuickBtn} onPress={() => setMessageText('Özel bir sipariş vermek istiyorum: ')}>
              <Text style={st.msgQuickBtnText}>📋 Özel sipariş</Text>
            </Pressable>
          </View>
          <Pressable
            style={[st.msgSendBtn, !messageText.trim() && { opacity: 0.5 }]}
            onPress={() => {
              if (messageText.trim()) {
                Alert.alert('Mesaj Gönderildi', 'Satıcı en kısa sürede yanıt verecektir.');
                setMessageText('');
                messageSheetRef.current?.close();
              }
            }}
          >
            <Text style={st.msgSendBtnText}>Gönder</Text>
          </Pressable>
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

  // ── Action Buttons (Takip Et, Mesaj, Özel Sipariş)
  actionBtnsRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  followBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  followBtnActive: { backgroundColor: colors.primary },
  followBtnText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  followBtnTextActive: { color: '#fff' },
  messageBtnInline: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F0ECE6',
  },
  messageBtnInlineText: { fontSize: 13, fontWeight: '700', color: '#6B5E50' },
  customOrderBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#E3F2FD',
  },
  customOrderBtnText: { fontSize: 13, fontWeight: '700', color: '#1565C0' },

  // ── Campaigns
  campaignsSection: { marginTop: 12 },
  campaignsScroll: { paddingHorizontal: 16, gap: 10 },
  campaignCard: {
    width: 220,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    gap: 6,
  },
  campaignTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  campaignBadge: { fontSize: 24 },
  campaignTypePill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  campaignTypeText: { fontSize: 10, fontWeight: '800' },
  campaignTitle: { fontSize: 14, fontWeight: '800' },
  campaignDesc: { fontSize: 12, color: '#6B5E50', lineHeight: 17 },
  campaignValid: { fontSize: 11, fontWeight: '600', marginTop: 2 },

  // ── Trust & Stats
  trustSection: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#1A1208', marginBottom: 14 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  statCard: {
    flex: 1,
    minWidth: '46%' as any,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  statEmoji: { fontSize: 22 },
  statNum: { fontSize: 18, fontWeight: '900', color: '#1A1208' },
  statLabel: { fontSize: 11, color: '#6B5E50', fontWeight: '600', textAlign: 'center' },

  monthStatsRow: {
    flexDirection: 'row',
    backgroundColor: '#FAF7F2',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  monthStatItem: { flex: 1, alignItems: 'center', gap: 4 },
  monthStatNum: { fontSize: 18, fontWeight: '900', color: '#1A1208' },
  monthStatLabel: { fontSize: 11, color: '#8A7E72', fontWeight: '500', textAlign: 'center' },
  monthStatDivider: { width: 1, backgroundColor: '#E8E2DA', marginVertical: 4 },

  popularItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    borderRadius: 14,
    padding: 14,
    gap: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  popularItemIcon: { fontSize: 28 },
  popularItemLabel: { fontSize: 11, color: '#8A7E72', fontWeight: '500' },
  popularItemName: { fontSize: 14, fontWeight: '800', color: '#1A1208' },
  popularItemCount: { fontSize: 16, fontWeight: '900', color: '#EF9F27' },

  trustBadgesRow: { gap: 8 },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FAF7F2',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  trustBadgeIcon: { fontSize: 16 },
  trustBadgeText: { fontSize: 12, color: '#6B5E50', fontWeight: '600', flex: 1 },

  // ── Menu Tags (Alerjen, Kalori, Stok)
  menuTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  calorieBadge: {
    backgroundColor: '#F5F0EA',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  calorieBadgeText: { fontSize: 9, fontWeight: '700', color: '#8A7E72' },
  dietBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  dietBadgeText: { fontSize: 9, fontWeight: '700' },
  allergenBadge: {
    backgroundColor: '#FFF3E0',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  allergenBadgeText: { fontSize: 9, fontWeight: '700', color: '#E65100' },
  stockBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  stockBadgeSoldOut: { backgroundColor: '#FFEBEE' },
  stockBadgeText: { fontSize: 9, fontWeight: '700', color: '#2E7D32' },
  stockBadgeTextSoldOut: { color: '#C62828' },

  // ── Enhanced Reviews
  topReviewCard: {
    backgroundColor: '#FFF8E1',
    borderRadius: 14,
    padding: 14,
    gap: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  topReviewBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#EF9F27',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 4,
  },
  topReviewBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  helpfulCountHighlight: { fontSize: 13, fontWeight: '700', color: '#EF9F27' },
  reviewMenuTag: {
    alignSelf: 'flex-start',
    backgroundColor: '#F5F0EA',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  reviewMenuTagText: { fontSize: 11, fontWeight: '600', color: '#6B5E50' },
  sellerReplyCard: {
    backgroundColor: '#F0FFF4',
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
    borderLeftWidth: 3,
    borderLeftColor: '#2E7D32',
  },
  sellerReplyHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  sellerReplyIcon: { fontSize: 12 },
  sellerReplyLabel: { fontSize: 11, fontWeight: '700', color: '#2E7D32' },
  sellerReplyText: { fontSize: 12, color: '#4E342E', lineHeight: 17 },
  reviewActions: { flexDirection: 'row', marginTop: 4 },
  helpfulBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F0EA',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  helpfulBtnActive: { backgroundColor: '#E3F2FD' },
  helpfulBtnText: { fontSize: 11, fontWeight: '600', color: '#8A7E72' },
  helpfulBtnTextActive: { color: '#1565C0' },

  // ── Delivery Section
  deliverySection: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  deliveryCard: {
    borderRadius: 16,
    padding: 4,
    borderWidth: 1,
    overflow: 'hidden',
  },
  deliveryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
  },
  deliveryIcon: { fontSize: 20, marginTop: 2 },
  deliveryLabel: { fontSize: 11, fontWeight: '500', marginBottom: 2 },
  deliveryValue: { fontSize: 13, fontWeight: '600' },
  deliveryFreeNote: { fontSize: 11, fontWeight: '500', color: '#2E7D32' },
  deliveryDivider: { height: 1, backgroundColor: '#F0ECE6', marginHorizontal: 14 },
  deliveryZonesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  deliveryZoneChip: {
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  deliveryZoneText: { fontSize: 12, fontWeight: '600', color: '#1565C0' },

  // ── Seller Story
  storySection: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  storyCard: {
    backgroundColor: '#FAF7F2',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  storyMotivation: { fontSize: 16, fontWeight: '800', color: colors.primary, fontStyle: 'italic', textAlign: 'center' },
  storyText: { fontSize: 13, lineHeight: 20 },
  expertiseRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  expertiseTag: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },
  expertiseTagText: { fontSize: 12, fontWeight: '600', color: '#6B5E50' },
  socialRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  socialBtn: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#F0ECE6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  socialBtnText: { fontSize: 12, fontWeight: '700', color: '#1A1208' },

  // ── Message BottomSheet
  msgSubtitle: { fontSize: 13, marginBottom: 12 },
  msgInput: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    minHeight: 80,
    marginBottom: 10,
  },
  msgQuickBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  msgQuickBtn: {
    backgroundColor: '#F5F0EA',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  msgQuickBtnText: { fontSize: 11, fontWeight: '600', color: '#6B5E50' },
  msgSendBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  msgSendBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
