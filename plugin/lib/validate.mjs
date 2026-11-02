// JSON Schema の必要な部分だけを扱う、依存なしの検査器。
// 対応：type, enum, const, pattern, minLength, minimum, required,
//       properties, additionalProperties(false), items, minItems, maxItems

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value, type) {
  if (type === 'integer') return Number.isInteger(value);
  return typeOf(value) === type;
}

/** 問題の一覧を返す。空配列なら合格。 */
export function validate(schema, value, path = '$') {
  const errors = [];

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path}: 型が違います（期待 ${types.join('|')}、実際 ${typeOf(value)}）`);
      return errors;
    }
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: 値は ${JSON.stringify(schema.const)} でなければなりません`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: 許可されていない値です（${JSON.stringify(value)}）`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: 文字数が足りません`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push(`${path}: 形式が違います（${value}）`);
    }
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path}: ${schema.minimum} 以上でなければなりません`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: 要素が足りません（最小 ${schema.minItems}）`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: 要素が多すぎます（最大 ${schema.maxItems}）`);
    }
    if (schema.items) {
      value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
    }
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}: 必須の項目 ${key} がありません`);
    }
    const props = schema.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      if (props[key]) {
        errors.push(...validate(props[key], child, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: 定義にない項目 ${key} があります`);
      }
    }
  }
  return errors;
}
