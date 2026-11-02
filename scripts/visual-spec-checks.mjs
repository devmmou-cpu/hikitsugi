// docs/design/visual-spec.md の値を、実際の画面で測って確かめるための一覧。
// 撮影プログラム（scripts/screenshots.mjs）が使う。作業の中ではこのファイルを変更しない。

export const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812, mobile: true },
  { name: 'tablet', width: 1024, height: 768, mobile: false },
  { name: 'pc', width: 1440, height: 900, mobile: false },
];

const COMMON_RADIUS = { borderTopLeftRadius: '12px' };

/**
 * 画面ごとの部品の値。getComputedStyle の値と比べる。
 * screen：intro、help（困ったとき）、symptom（まずこれだけのあるページ）、contacts
 * only：phone、tablet、pc のどれかに限る。ないものは全部の幅で確かめる
 * min：最小値（px）で比べる項目。exact の代わりに使う
 * js：false なら JavaScript なしの条件で見る
 */
export const CHECKS = [
  // 文字（6-2）
  { screen: 'help', selector: 'html', exact: { fontSize: '17px' } },
  { screen: 'help', selector: '#tab-help h2', only: 'phone', exact: { fontSize: '28px', fontWeight: '700' } },
  { screen: 'contacts', selector: '#tab-contacts h2', only: 'pc', exact: { fontSize: '32px', fontWeight: '700' } },
  { screen: 'symptom', selector: '.symptom-title', only: 'phone', exact: { fontSize: '26px', fontWeight: '700' } },
  { screen: 'symptom', selector: '.symptom-title', only: 'pc', exact: { fontSize: '30px', fontWeight: '700' } },
  { screen: 'symptom', selector: '.part-title', exact: { fontSize: '22px', fontWeight: '700' } },
  { screen: 'symptom', selector: '.first-body', exact: { fontSize: '19px', fontWeight: '500' } },
  { screen: 'symptom', selector: '.first-kicker', exact: { fontWeight: '700' } },
  { screen: 'symptom', selector: '.step-body', exact: { fontSize: '17px', fontWeight: '400' } },
  { screen: 'symptom', selector: '.step-note', exact: { fontSize: '15px' } },
  { screen: 'help', selector: '.sym-title', only: 'phone', exact: { fontSize: '18px', fontWeight: '700' } },
  { screen: 'help', selector: '.group-title', exact: { fontSize: '14px', fontWeight: '700' } },
  { screen: 'help', selector: '.chip-secret', exact: { fontSize: '13px', fontWeight: '700', borderTopLeftRadius: '4px' } },
  { screen: 'help', selector: '.tabs a span', only: 'phone', exact: { fontSize: '13px', fontWeight: '700' } },
  { screen: 'contacts', selector: '.btn-call .num', exact: { fontSize: '22px', fontWeight: '700' } },
  { screen: 'contacts', selector: '.btn-call .btn-label', exact: { fontSize: '16px' } },
  { screen: 'symptom', selector: 'code.path', exact: { fontSize: '16px', fontWeight: '500' } },

  // 判定バッジ（7-2）。4種で形が同じ
  { screen: 'intro', selector: '.badge', exact: { display: 'inline-flex', height: '32px', fontSize: '15px', fontWeight: '700', borderTopLeftRadius: '999px' } },

  // 症状カード（7-1）
  { screen: 'help', selector: '.sym', only: 'phone', min: { minHeight: 72 } },
  { screen: 'help', selector: '.sym', only: 'pc', min: { height: 44 } },

  // 手順カード（7-3）
  { screen: 'symptom', selector: '.step label', min: { minHeight: 64 }, exact: { paddingTop: '16px' } },
  { screen: 'symptom', selector: '.step-n', exact: { width: '32px', height: '32px', borderTopWidth: '2px', fontSize: '15px', fontWeight: '700' } },
  { screen: 'symptom', selector: '.step-box', exact: { width: '28px', height: '28px', borderTopWidth: '2px', borderTopLeftRadius: '6px' } },

  // まずこれだけ（7-4）。ページ内で唯一の暖色の枠と影
  { screen: 'symptom', selector: '.first', only: 'phone', exact: { paddingTop: '20px', borderTopWidth: '2px', ...COMMON_RADIUS } },
  { screen: 'symptom', selector: '.first', only: 'pc', exact: { paddingTop: '24px', borderTopWidth: '2px', ...COMMON_RADIUS } },
  { screen: 'symptom', selector: '.goal', exact: { paddingTop: '12px', paddingLeft: '16px', borderTopLeftRadius: '8px', fontWeight: '700' } },

  // 帯（7-9）
  { screen: 'symptom', selector: '.band', exact: { paddingTop: '12px', paddingLeft: '16px', borderTopLeftRadius: '8px', fontSize: '16px' } },

  // 連絡先と電話（7-5、7-6）
  { screen: 'contacts', selector: '.contact-box', exact: { paddingTop: '20px', ...COMMON_RADIUS } },
  { screen: 'contacts', selector: '.contact-name', exact: { fontSize: '20px', fontWeight: '700' } },
  { screen: 'contacts', selector: '.contact-role', exact: { fontSize: '14px' } },
  { screen: 'contacts', selector: '.btn-call', min: { minHeight: 56 }, exact: { ...COMMON_RADIUS } },

  // コピー（7-7）
  { screen: 'symptom', selector: '.btn-copy', min: { minHeight: 48 }, exact: { borderTopWidth: '2px', ...COMMON_RADIUS, fontSize: '16px', fontWeight: '700' } },

  // 用語（7-8）
  { screen: 'symptom', selector: 'details.term summary', min: { minHeight: 48 } },

  // はじめに（8-1）
  { screen: 'intro', selector: '.intro-title', only: 'phone', exact: { fontSize: '34px', fontWeight: '700' } },
  { screen: 'intro', selector: '.intro-title', only: 'pc', exact: { fontSize: '44px', fontWeight: '700' } },
  { screen: 'intro', selector: '.btn-primary', min: { minHeight: 56 } },

  // フッター（8-3）
  { screen: 'help', selector: '.site-footer', exact: { fontSize: '14px' } },

  // 下部タブと上部バー（3-2、4-1）
  { screen: 'help', selector: '.tabs', only: 'phone', exact: { position: 'sticky' }, min: { height: 64 } },
  { screen: 'help', selector: '.topbar', only: 'pc', exact: { position: 'sticky', height: '64px' } },
  { screen: 'help', selector: '.topbar', only: 'tablet', exact: { position: 'sticky', height: '64px' } },
  { screen: 'help', selector: '.topnav a', only: 'pc', exact: { fontSize: '16px' } },
];

/** 色の組み合わせ。文字と面のコントラストは撮影プログラムが全文字で測る。ここは決まった面の色。 */
export const COLOR_CHECKS = [
  { screen: 'symptom', selector: '.first', borderColorVar: '--accent' },
  { screen: 'contacts', selector: '.btn-call', backgroundVar: '--accent' },
  { screen: 'symptom', selector: '.btn-copy', borderColorVar: '--accent' },
  { screen: 'symptom', selector: '.goal', backgroundVar: '--ok-bg', colorVar: '--ok-fg' },
  { screen: 'symptom', selector: '.band-branch', backgroundVar: '--warn-bg', colorVar: '--warn-fg' },
  { screen: 'symptom', selector: '.band-exception', backgroundVar: '--danger-bg', colorVar: '--danger-fg' },
  { screen: 'symptom', selector: '.step-n', borderColorVar: '--ink' },
  { screen: 'intro', selector: '.seal', colorVar: '--ink' },
  { screen: 'help', selector: '.chip-secret', colorVar: '--ink' },
];
