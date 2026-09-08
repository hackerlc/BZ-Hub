import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { CloudLauncherState, LauncherState } from "../types";
import { mergeCloudState, toCloudState } from "./cloudMerge";
import { cloudStateFingerprint } from "./cloudFingerprint";
import { parseSupabaseEmailCredential } from "./authLink";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim();

let client: SupabaseClient | null = null;

export const isCloudConfigured = Boolean(supabaseUrl && supabaseKey);

export function getSupabaseClient(): SupabaseClient {
  if (!isCloudConfigured) throw new Error("尚未配置 Supabase 项目");
  if (!client) {
    client = createClient(supabaseUrl!, supabaseKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

export async function getCloudSession(): Promise<Session | null> {
  if (!isCloudConfigured) return null;
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function sendEmailOtp(email: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw friendlyAuthError(error, "登录邮件发送失败");
}

function friendlyAuthError(error: unknown, fallback: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  const normalized = `${code} ${message}`.toLowerCase();

  if (normalized.includes("otp_expired") || normalized.includes("expired")) {
    return new Error("登录链接或验证码已使用、已过期，请重新发送登录邮件");
  }
  if (normalized.includes("rate limit") || normalized.includes("over_request_rate_limit")) {
    return new Error("请求过于频繁，请稍等几分钟后再试");
  }
  if (normalized.includes("invalid") && (normalized.includes("token") || normalized.includes("otp"))) {
    return new Error("登录链接或验证码无效，请确认没有先点击链接；必要时重新发送邮件");
  }
  if (normalized.includes("failed to fetch") || normalized.includes("network")) {
    return new Error("无法连接 Supabase，请检查网络后重试");
  }
  return new Error(message || fallback);
}

export async function verifyEmailLogin(email: string, value: string): Promise<Session> {
  const credential = parseSupabaseEmailCredential(supabaseUrl ?? "", value);
  const response = credential.kind === "otp"
    ? await getSupabaseClient().auth.verifyOtp({
        email,
        token: credential.token,
        type: "email",
      })
    : await getSupabaseClient().auth.verifyOtp({
        token_hash: credential.tokenHash,
        type: credential.type,
      });

  if (response.error) throw friendlyAuthError(response.error, "登录验证失败");
  if (!response.data.session) throw new Error("登录凭证有效，但没有创建登录会话，请重新发送邮件");
  const { session } = response.data;
  if (session.user.email?.toLowerCase() !== email.trim().toLowerCase()) {
    await getSupabaseClient().auth.signOut({ scope: "global" });
    throw new Error("登录链接与当前填写的邮箱不一致，请检查邮箱后重试");
  }
  return session;
}

export async function signOutCloud(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut({ scope: "global" });
  if (error) throw error;
}

interface SnapshotRow {
  state: CloudLauncherState;
  revision: number;
  updated_at: string;
}

function withSyncMetadata(state: LauncherState, snapshot: SnapshotRow): LauncherState {
  return {
    ...state,
    syncMeta: {
      enabled: true,
      cloudRevision: snapshot.revision,
      lastSyncedAt: new Date().toISOString(),
    },
  };
}

async function fetchSnapshot(userId: string): Promise<SnapshotRow | null> {
  const { data, error } = await getSupabaseClient()
    .from("launcher_snapshots")
    .select("state, revision, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data as SnapshotRow | null;
}

export async function syncLauncherState(local: LauncherState, userId: string): Promise<LauncherState> {
  let remote = await fetchSnapshot(userId);

  if (!remote) {
    const { data, error } = await getSupabaseClient()
      .from("launcher_snapshots")
      .insert({
        user_id: userId,
        state: toCloudState(local),
        revision: 1,
      })
      .select("state, revision, updated_at")
      .single();

    if (error) {
      remote = await fetchSnapshot(userId);
      if (!remote) throw error;
    } else {
      remote = data as SnapshotRow;
    }
  }

  let merged = mergeCloudState(local, remote.state);
  let revision = remote.revision;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (cloudStateFingerprint(merged) === cloudStateFingerprint(remote.state)) {
      return withSyncMetadata(merged, remote);
    }

    const { data, error } = await getSupabaseClient()
      .from("launcher_snapshots")
      .update({
        state: toCloudState(merged),
        revision: revision + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("revision", revision)
      .select("state, revision, updated_at")
      .maybeSingle();

    if (error) throw error;
    if (data) {
      const saved = data as SnapshotRow;
      return withSyncMetadata(mergeCloudState(merged, saved.state), saved);
    }

    const latest = await fetchSnapshot(userId);
    if (!latest) throw new Error("云端数据在同步过程中消失，请重试");
    merged = mergeCloudState(merged, latest.state);
    revision = latest.revision;
    remote = latest;
  }

  throw new Error("另一台设备正在修改数据，请稍后再同步");
}
