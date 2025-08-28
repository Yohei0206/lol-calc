import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>ページが見つかりません</h1>
      <p style={{ marginTop: 8 }}>指定されたページは存在しません。</p>
      <Link
        href="/"
        style={{ color: "#3b82f6", marginTop: 16, display: "inline-block" }}
      >
        トップへ戻る
      </Link>
    </div>
  );
}
