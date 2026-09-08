export type SupabaseEmailCredential =
  | { kind: "otp"; token: string }
  | { kind: "magiclink"; tokenHash: string; type: "email" | "magiclink" };

function parseUrl(value: string): URL {
  try {
    return new URL(value.replaceAll("&amp;", "&"));
  } catch {
    throw new Error("请输入六位验证码，或粘贴邮件中 Sign in 按钮的原始链接");
  }
}

function unwrapGoogleRedirect(url: URL): URL {
  const isGoogleRedirect =
    (url.hostname === "google.com" || url.hostname === "www.google.com") &&
    url.pathname === "/url";
  if (!isGoogleRedirect) return url;

  const target = url.searchParams.get("q") ?? url.searchParams.get("url");
  if (!target) throw new Error("无法从邮件跳转地址中读取登录链接，请右键 Sign in 并复制链接地址");
  return parseUrl(target);
}

export function parseSupabaseEmailCredential(
  configuredUrl: string,
  credential: string,
): SupabaseEmailCredential {
  const value = credential.trim();
  const otp = value.replace(/[\s-]/g, "");
  if (/^\d{6}$/.test(otp)) return { kind: "otp", token: otp };

  if (!value) throw new Error("请输入六位验证码，或粘贴邮件中的登录链接");
  if (value.length > 10_000) throw new Error("登录链接过长，请重新复制邮件中的 Sign in 链接");

  let url = unwrapGoogleRedirect(parseUrl(value));
  if (url.hash.includes("access_token=") || url.hash.includes("refresh_token=")) {
    throw new Error("这是点击后生成的回跳地址，不能再次登录。请重新发送邮件，并直接复制 Sign in 的原始链接");
  }

  const expected = parseUrl(configuredUrl);
  if (url.protocol !== "https:" || url.origin !== expected.origin || url.pathname !== "/auth/v1/verify") {
    throw new Error("这不是当前 Supabase 项目的原始登录链接，请重新复制邮件中的 Sign in 链接");
  }

  const tokenHash = url.searchParams.get("token") ?? url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (!tokenHash || tokenHash.length < 16 || /\s/.test(tokenHash)) {
    throw new Error("登录链接缺少有效的一次性凭证，请重新发送邮件");
  }
  if (type !== "email" && type !== "magiclink") {
    throw new Error("登录链接类型无效，请重新发送邮件");
  }

  return { kind: "magiclink", tokenHash, type };
}
