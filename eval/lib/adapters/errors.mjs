// アダプターとランナーで共有する例外。実行として記録せず、指定の誤りや未実装として止める。

export class UsageError extends Error {}
export class NotImplementedError extends Error {}
