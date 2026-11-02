// 費用の計算に使う単価（米ドル / 100万トークン）。
// 出典：https://platform.claude.com/docs/en/about-claude/pricing（2026-11-02 確認）
// 表にないモデルは費用を null にする。推測の単価で計算しない。

export const PRICES = {
  'claude-opus-5-5': { input: 4, cache_write_5m: 5, cache_read: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, cache_write_5m: 2.5, cache_read: 0.1, output: 10 },
  // 10万トークン以下の単価。評価の入力はこの範囲に収まる
  'claude-haiku-5-5': { input: 0.1, cache_write_5m: 0.125, cache_read: 0.01, output: 0.5 },
};

const MILLION = 1_000_000;

/** API の usage から費用を計算する。thinking の分は output_tokens に含まれる。 */
export function costOf(model, usage) {
  const price = PRICES[model];
  if (!price || !usage) return null;
  const dollars =
    ((usage.input_tokens ?? 0) * price.input +
      (usage.cache_creation_input_tokens ?? 0) * price.cache_write_5m +
      (usage.cache_read_input_tokens ?? 0) * price.cache_read +
      (usage.output_tokens ?? 0) * price.output) /
    MILLION;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}
