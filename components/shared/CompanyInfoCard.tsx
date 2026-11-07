import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  COMPANY_TYPE_LABELS,
  validateCompanyInfo,
  type CompanyForm,
  type CompanyType,
} from '@/lib/company-info';
import {
  fetchCompanyInfo,
  fetchMarketplaceEnabled,
  fetchMySubmerchant,
  saveCompanyInfo,
  type SubmerchantRow,
} from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { normalizeTrPhone } from '@/lib/phone';
import { useTheme } from '@/lib/theme-context';

const EMPTY: CompanyForm = {
  company_type: null,
  legal_company_title: '',
  tax_office: '',
  tax_number: '',
  identity_number: '',
  email: '',
  gsm_number: '',
  address: '',
};

const TYPES: CompanyType[] = ['LIMITED_OR_JOINT_STOCK_COMPANY', 'PRIVATE_COMPANY'];

/** Otomatik satıcı ödemesi için şirket bilgileri. Anahtar kapalıyken hiçbir şey göstermez. */
export function CompanyInfoCard({ sellerId }: { sellerId: string }) {
  const { colors: t } = useTheme();
  const [enabled, setEnabled] = useState(false);
  const [form, setForm] = useState<CompanyForm>(EMPTY);
  const [submerchant, setSubmerchant] = useState<SubmerchantRow | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof CompanyForm, string>>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!(await fetchMarketplaceEnabled())) return;
      const [info, sub] = await Promise.all([fetchCompanyInfo(sellerId), fetchMySubmerchant(sellerId)]);
      if (!active) return;
      setEnabled(true);
      setSubmerchant(sub);
      if (info) {
        setForm({
          company_type: info.company_type,
          legal_company_title: info.legal_company_title,
          tax_office: info.tax_office,
          tax_number: info.tax_number ?? '',
          identity_number: info.identity_number,
          email: info.email,
          gsm_number: info.gsm_number,
          address: info.address,
        });
      }
    })().catch(() => undefined);
    return () => { active = false; };
  }, [sellerId]);

  if (!enabled) return null;

  const registered = !!submerchant?.submerchant_key;
  const set = (key: keyof CompanyForm) => (value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => ({ ...prev, [key]: undefined }));
    setMessage(null);
  };

  const save = async () => {
    if (saving) return;
    const result = validateCompanyInfo(form, normalizeTrPhone);
    if (!result.ok) {
      setErrors(result.errors);
      setMessage({ ok: false, text: 'Kırmızı alanları düzelt.' });
      return;
    }
    setSaving(true);
    try {
      await saveCompanyInfo(sellerId, result.value);
      setMessage({
        ok: true,
        text: registered ? 'Kaydedildi. Yönetici güncellemeyi iyzico\'ya gönderince geçerli olur.' : 'Kaydedildi. Yönetici kaydını iyzico\'ya gönderecek.',
      });
    } catch {
      setMessage({ ok: false, text: 'Kaydedilemedi, tekrar dene.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Text style={[st.section, { color: t.heading }]}>Şirket bilgileri</Text>
      <View style={[st.card, { backgroundColor: t.surface }]}>
        <Text style={[st.hint, { color: t.textSecondary }]}>
          Online siparişlerin ödemesini iyzico doğrudan hesabına göndersin diye bu bilgiler gerekli. Bilgiler vergi levhanla aynı olmalı.
        </Text>
        <View style={st.status}>
          <Ionicons
            name={registered ? 'checkmark-circle' : 'time-outline'}
            size={18}
            color={registered ? t.success : t.textSecondary}
          />
          <Text style={[st.statusText, { color: registered ? t.success : t.textSecondary }]}>
            {registered ? 'iyzico kaydın tamam' : 'iyzico kaydın henüz yapılmadı'}
          </Text>
        </View>

        <View>
          <Text style={[st.label, { color: t.text }]}>Şirket türü</Text>
          <View style={st.chips}>
            {TYPES.map(type => {
              const on = form.company_type === type;
              return (
                <Pressable
                  key={type}
                  // iyzico'da tür kayıttan sonra değiştirilemez.
                  disabled={registered}
                  onPress={() => { setForm(prev => ({ ...prev, company_type: type })); setErrors(prev => ({ ...prev, company_type: undefined })); }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on, disabled: registered }}
                  style={[st.chip, { backgroundColor: on ? t.accent : t.background, opacity: registered && !on ? 0.5 : 1 }]}
                >
                  <Text style={[st.chipText, { color: on ? t.onAccent : t.text }]}>{COMPANY_TYPE_LABELS[type]}</Text>
                </Pressable>
              );
            })}
          </View>
          {errors.company_type ? <Text style={[st.error, { color: t.danger }]}>{errors.company_type}</Text> : null}
          {registered ? <Text style={[st.hint, { color: t.textSecondary }]}>Şirket türü iyzico kaydından sonra değişmez.</Text> : null}
        </View>

        <Input label="Yasal unvan" value={form.legal_company_title} onChangeText={set('legal_company_title')} error={errors.legal_company_title} maxLength={255} />
        <Input label="Vergi dairesi" value={form.tax_office} onChangeText={set('tax_office')} error={errors.tax_office} maxLength={255} />
        <Input
          label={form.company_type === 'PRIVATE_COMPANY' ? 'Vergi numarası (isteğe bağlı)' : 'Vergi numarası'}
          value={form.tax_number}
          onChangeText={set('tax_number')}
          error={errors.tax_number}
          keyboardType="number-pad"
          maxLength={11}
        />
        <Input
          label="Yetkilinin T.C. kimlik numarası"
          value={form.identity_number}
          onChangeText={set('identity_number')}
          error={errors.identity_number}
          keyboardType="number-pad"
          maxLength={11}
          autoComplete="off"
        />
        <Input label="E-posta" value={form.email} onChangeText={set('email')} error={errors.email} keyboardType="email-address" autoCapitalize="none" maxLength={254} />
        <Input label="Cep telefonu" value={form.gsm_number} onChangeText={set('gsm_number')} error={errors.gsm_number} keyboardType="phone-pad" maxLength={16} />
        <Input label="Şirket adresi" value={form.address} onChangeText={set('address')} error={errors.address} multiline maxLength={255} />

        <Text style={[st.hint, { color: t.textSecondary }]}>
          IBAN'ı Kazancım ekranındaki Ödeme hesabı bölümünden gir. IBAN'ın sahibi yasal unvanla aynı olmalı, yoksa iyzico ödemeyi gönderemez.
        </Text>
        {message ? <Text style={[st.message, { color: message.ok ? t.success : t.danger }]}>{message.text}</Text> : null}
        <Button label={saving ? 'Kaydediliyor...' : 'Şirket bilgilerini kaydet'} onPress={save} disabled={saving} fullWidth />
      </View>
    </>
  );
}

const st = StyleSheet.create({
  section: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.4, marginTop: 8, marginBottom: 8 },
  card: { borderRadius: 16, padding: 14, marginBottom: 12, gap: 12 },
  hint: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontSize: 13, fontFamily: fonts.semibold },
  label: { fontSize: 13, fontFamily: fonts.semibold, marginBottom: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: { minHeight: 44, borderRadius: 10, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontFamily: fonts.semibold },
  error: { fontSize: 12, fontFamily: fonts.semibold },
  message: { fontSize: 13, fontFamily: fonts.semibold },
});
