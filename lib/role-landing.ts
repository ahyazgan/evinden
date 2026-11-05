/**
 * Girişten ve uygulama açılışından sonra kimin nereye gideceği. Uygulama girişsiz de gezilir, bu
 * yüzden herkes müşteri ana sayfasından başlar; onaylı satıcı buradan bir kez paneline alınır.
 * "Müşteri modu" ile geri dönen satıcı panele itilmez.
 */
export type LandingProfile = { id: string; role: string; is_approved: boolean };

export function isApprovedSeller(profile: LandingProfile | null | undefined): boolean {
  return profile?.role === 'seller' && profile.is_approved === true;
}

/** Müşteri ana sayfası mı? Derin bağlantıyla açılan başka bir sayfa bozulmasın diye yalnızca burası yönlendirilir. */
export function isCustomerHome(segments: readonly string[]): boolean {
  if (segments[0] !== '(customer)') return false;
  return segments.length === 1 || segments[1] === 'index';
}

export type SellerLanding = {
  /** Gidilecek adres; null ise yerinde kalınır */
  route: '/restoran/dashboard' | null;
  /** Bu kullanıcı için karar verildi mi */
  settled: boolean;
};

/**
 * Giriş ekranındayken karar verilmez: giriş ekranı başarıda ana sayfaya geçer, karar orada alınır.
 * Önce davranılırsa giriş ekranının kendi yönlendirmesi kararı ezer.
 */
export function sellerLanding(
  profile: LandingProfile | null | undefined,
  segments: readonly string[],
  alreadySettled: boolean,
): SellerLanding {
  if (!isApprovedSeller(profile) || alreadySettled) return { route: null, settled: alreadySettled };
  if (segments[0] === '(auth)') return { route: null, settled: false };
  return { route: isCustomerHome(segments) ? '/restoran/dashboard' : null, settled: true };
}

/** Restoran paneli yalnızca onaylı satıcınındır. */
export function mustLeaveSellerArea(
  profile: LandingProfile | null | undefined,
  segments: readonly string[],
): boolean {
  return segments[0] === 'restoran' && !isApprovedSeller(profile);
}
