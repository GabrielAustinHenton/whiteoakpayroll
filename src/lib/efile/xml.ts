/** Tiny XML builder: elements with optional attributes; empty/undefined children are dropped. */
export type XmlNode = { tag: string; attrs?: Record<string, string>; children?: (XmlNode | undefined)[]; text?: string };

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function el(tag: string, content?: string | number | (XmlNode | undefined)[], attrs?: Record<string, string>): XmlNode | undefined {
  if (content === undefined || content === "") return undefined;
  if (Array.isArray(content)) {
    const kids = content.filter(Boolean) as XmlNode[];
    return kids.length ? { tag, attrs, children: kids } : undefined;
  }
  return { tag, attrs, text: String(content) };
}

export function render(n: XmlNode, indent = 0): string {
  const pad = "  ".repeat(indent);
  const a = n.attrs ? Object.entries(n.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join("") : "";
  if (n.text !== undefined) return `${pad}<${n.tag}${a}>${esc(n.text)}</${n.tag}>`;
  return `${pad}<${n.tag}${a}>\n${(n.children ?? []).map((c) => render(c as XmlNode, indent + 1)).join("\n")}\n${pad}</${n.tag}>`;
}

export function document(root: XmlNode): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${render(root)}\n`;
}

/** IRS money: whole dollars or dollars and cents with two decimals ("USAmountType"/"USDecimalAmountType"). */
export const usd = (cents: number) => (cents / 100).toFixed(2);
