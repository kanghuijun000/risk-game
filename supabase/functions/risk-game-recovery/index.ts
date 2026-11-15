import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function digestPassword(password: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(password));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function passwordFingerprints(password: string, secret: string) {
  // Compare 8 consecutive Unicode characters, ignoring case and equivalent Unicode forms.
  const chars = Array.from(password.normalize("NFKC").toLocaleLowerCase("en-US"));
  const unique = new Set<string>();
  for (let i = 0; i <= chars.length - 8; i++) {
    const part = chars.slice(i, i + 8).join("");
    unique.add(await digestPassword("risk-game-recovery-substring-v1:" + part, secret));
  }
  return [...unique];
}

function validPassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= 10 &&
    password.length <= 128 && !password.includes("\u0000");
}

function validDeviceId(deviceId: unknown): deviceId is string {
  return typeof deviceId === "string" &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(deviceId);
}

async function deviceIsActive(service: ReturnType<typeof createClient>, userId: string, deviceId: unknown) {
  if (!validDeviceId(deviceId)) return false;
  const { data, error } = await service.from("risk_game_device_sessions")
    .select("device_id").eq("user_id", userId).maybeSingle();
  return !error && data?.device_id === deviceId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "지원하지 않는 요청입니다." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const hmacSecret = Deno.env.get("RECOVERY_HMAC_SECRET")!;
  if (!url || !anonKey || !serviceKey || !hmacSecret || hmacSecret.length < 32) {
    return reply({ error: "계정 복구 서버 설정이 완료되지 않았습니다." }, 503);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: "요청 내용을 읽을 수 없습니다." }, 400); }
  const action = body.action;
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (action === "lookup") {
    const password = body.password;
    if (!validPassword(password)) return reply({ error: "복구 비밀번호가 올바르지 않습니다." }, 400);
    const forwardedFor = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const clientIp = forwardedFor.split(",")[0].trim().slice(0, 128);
    const ipHash = await digestPassword(clientIp, hmacSecret);
    const { data: allowed, error: limitError } = await service.rpc("consume_risk_game_recovery_attempt", {
      p_ip_hash: ipHash, p_limit: 8,
    });
    if (limitError) return reply({ error: "복구 서버의 보안 제한 기능이 준비되지 않았습니다. 잠시 후 다시 시도하세요." }, 503);
    if (allowed !== true) return reply({ error: "시도 횟수가 너무 많습니다. 1분 뒤 다시 시도하세요." }, 429);

    const digest = await digestPassword(password, hmacSecret);
    const { data, error } = await service.from("risk_game_recovery_credentials")
      .select("user_id, synthetic_email").eq("password_digest", digest).maybeSingle();
    if (error || !data) return reply({ error: "복구 비밀번호가 일치하는 계정을 찾지 못했습니다." }, 401);

    // Older accounts have no substring fingerprints yet. Backfill them when the
    // owner successfully proves the full recovery password; never block recovery
    // if a legacy password conflicts with a fingerprint already claimed by another account.
    const fingerprints = await passwordFingerprints(password, hmacSecret);
    const { error: backfillError } = await service.rpc(
      "reserve_risk_game_recovery_fingerprints",
      { p_user_id: data.user_id, p_fingerprints: fingerprints },
    );
    if (backfillError) {
      console.error("Recovery fingerprint backfill failed:", backfillError);
    }
    return reply({ email: data.synthetic_email });
  }

  // Allow a stale device to delete only after proving the recovery password.
  // If the user was already deleted on another device, report that state so the
  // stale device can clear its local cache without pretending a server deletion occurred.
  if (action === "delete_account_with_recovery_password") {
    const staleUserId = body.staleUserId;
    const password = body.password;
    if (typeof staleUserId !== "string" ||
        !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(staleUserId)) {
      return reply({ error: "이 기기의 기존 계정 정보를 확인할 수 없습니다. 기존 계정 복구를 이용해 주세요." }, 400);
    }
    if (!validPassword(password)) {
      return reply({ error: "복구 비밀번호를 10~128자로 입력해 주세요." }, 400);
    }

    const forwardedFor = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const clientIp = forwardedFor.split(",")[0].trim().slice(0, 128);
    const ipHash = await digestPassword(clientIp, hmacSecret);
    const { data: allowed, error: limitError } = await service.rpc("consume_risk_game_recovery_attempt", {
      p_ip_hash: ipHash, p_limit: 8,
    });
    if (limitError) return reply({ error: "삭제 확인을 위한 보안 제한 기능이 준비되지 않았습니다. 잠시 후 다시 시도하세요." }, 503);
    if (allowed !== true) return reply({ error: "시도 횟수가 너무 많습니다. 1분 뒤 다시 시도하세요." }, 429);

    const digest = await digestPassword(password, hmacSecret);
    const { data: credential, error: credentialError } = await service
      .from("risk_game_recovery_credentials")
      .select("user_id, password_digest")
      .eq("user_id", staleUserId)
      .maybeSingle();
    if (credentialError) return reply({ error: "복구 계정 상태를 확인하지 못했습니다." }, 500);

    if (credential) {
      if (credential.password_digest !== digest) {
        return reply({ error: "복구 비밀번호가 일치하지 않습니다. 계정은 삭제되지 않았습니다." }, 401);
      }
      const { error: deleteError } = await service.auth.admin.deleteUser(staleUserId);
      if (deleteError) {
        const { data: existingUser } = await service.auth.admin.getUserById(staleUserId);
        if (existingUser?.user) {
          console.error("Recovery-password account deletion failed:", deleteError);
          return reply({ error: "서버에서 계정 삭제를 완료하지 못했습니다. 잠시 후 다시 시도하세요." }, 500);
        }
      }
      return reply({ ok: true, deleted: true });
    }

    const { data: existingUser } = await service.auth.admin.getUserById(staleUserId);
    if (!existingUser?.user) {
      return reply({ ok: true, deleted: true, alreadyDeleted: true });
    }
    return reply({ error: "이 계정에는 복구 비밀번호가 설정되어 있지 않아 안전하게 삭제할 수 없습니다. 계정 복구를 먼저 진행해 주세요." }, 409);
  }

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return reply({ error: "로그인된 계정이 필요합니다." }, 401);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return reply({ error: "계정을 확인할 수 없습니다. 다시 연결해 주세요." }, 401);
  const user = authData.user;

  if (action === "delete_account") {
    const { data: credential, error: credentialError } = await service
      .from("risk_game_recovery_credentials")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (credentialError) {
      return reply({ error: "복구 계정 상태를 확인하지 못해 삭제를 진행할 수 없습니다." }, 500);
    }

    // If recovery is configured, only the currently owning device may delete the account.
    if (credential) {
      if (!validDeviceId(body.deviceId)) {
        return reply({ error: "기기 식별 정보를 확인할 수 없습니다. 앱을 새로고침해 주세요." }, 400);
      }
      if (!await deviceIsActive(service, user.id, body.deviceId)) {
        return reply({ error: "다른 기기에서 계정을 사용 중입니다. 현재 계정을 복구한 기기에서 삭제해 주세요." }, 409);
      }
    }

    // Account-owned records cascade with auth.users, including the recovery password,
    // password fingerprints, cloud save, profile/friend code, device session and friend links.
    const { error: deleteError } = await service.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error("Risk Game account deletion failed:", deleteError);
      return reply({ error: "서버에서 계정 삭제를 완료하지 못했습니다. 잠시 후 다시 시도하세요." }, 500);
    }
    return reply({ ok: true, deleted: true });
  }

  if (action === "claim_device") {
    const deviceId = body.deviceId;
    if (!validDeviceId(deviceId)) return reply({ error: "기기 식별 정보를 확인할 수 없습니다. 앱을 새로고침해 주세요." }, 400);

    const { data: credential, error: credentialError } = await service.from("risk_game_recovery_credentials")
      .select("password_digest").eq("user_id", user.id).maybeSingle();
    if (credentialError) return reply({ error: "기기 연결 상태를 확인하지 못했습니다." }, 500);
    if (credential) {
      if (!validPassword(body.password)) return reply({ error: "기기 연결을 확인할 복구 비밀번호가 필요합니다." }, 401);
      const digest = await digestPassword(body.password, hmacSecret);
      if (digest !== credential.password_digest) return reply({ error: "복구 비밀번호가 일치하지 않습니다." }, 401);
    }

    const { error } = await service.from("risk_game_device_sessions").upsert({
      user_id: user.id, device_id: deviceId, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) return reply({ error: "이 기기를 계정에 연결하지 못했습니다." }, 500);
    return reply({ ok: true, active: true });
  }

  if (action === "check_device") {
    const deviceId = body.deviceId;
    if (!validDeviceId(deviceId)) return reply({ error: "기기 식별 정보를 확인할 수 없습니다." }, 400);

    // 먼저 기존 기기 기록을 읽습니다. 이미 기록이 있으면 절대 덮어쓰지 않습니다.
    const { data: existingSession, error: sessionReadError } = await service
      .from("risk_game_device_sessions")
      .select("device_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (sessionReadError) {
      return reply({ error: "기기 연결 상태를 확인하지 못했습니다." }, 500);
    }
    if (existingSession) {
      return reply({ active: existingSession.device_id === deviceId });
    }

    // 기록이 없는 구형 계정만 최초 기기를 등록합니다. 동시에 다른 기기가 등록했으면
    // unique key 충돌을 허용하고, 실제 저장된 기기를 다시 확인합니다.
    const { error: insertError } = await service.from("risk_game_device_sessions")
      .insert({ user_id: user.id, device_id: deviceId, updated_at: new Date().toISOString() });
    if (insertError && insertError.code !== "23505") {
      return reply({ error: "기기 연결 상태를 확인하지 못했습니다." }, 500);
    }
    const active = await deviceIsActive(service, user.id, deviceId);
    return reply({ active });
  }

  if (["register", "change", "save_state", "load_state"].includes(String(action))) {
    const deviceId = body.deviceId;
    if (!await deviceIsActive(service, user.id, deviceId)) {
      return reply({ error: "다른 기기에서 이 계정을 복구했습니다. 이 기기에서는 계정을 다시 복구해야 합니다.", code: "DEVICE_REPLACED" }, 409);
    }
  }

  if (action === "register" || action === "change") {
    const password = body.password;
    if (!validPassword(password)) return reply({ error: "비밀번호는 10~128자로 설정해 주세요." }, 400);
    const digest = await digestPassword(password, hmacSecret);
    const email = `rg-${digest.slice(0, 60)}@recovery.risk-game.invalid`;

    if (action === "change") {
      const oldPassword = body.oldPassword;
      if (!validPassword(oldPassword)) return reply({ error: "기존 비밀번호가 일치하지 않습니다." }, 400);
      const oldDigest = await digestPassword(oldPassword, hmacSecret);
      const { data: existing, error } = await service.from("risk_game_recovery_credentials")
        .select("password_digest").eq("user_id", user.id).maybeSingle();
      if (error || !existing || existing.password_digest !== oldDigest) {
        return reply({ error: "기존 비밀번호가 일치하지 않습니다." }, 401);
      }
      if (oldDigest === digest) return reply({ error: "기존 비밀번호와 다른 비밀번호를 입력해 주세요." }, 400);
    } else {
      const { data: existing } = await service.from("risk_game_recovery_credentials")
        .select("user_id").eq("user_id", user.id).maybeSingle();
      if (existing) return reply({ error: "이미 복구 비밀번호가 설정되어 있습니다. 변경 기능을 이용해 주세요." }, 409);
    }

    const { data: collision } = await service.from("risk_game_recovery_credentials")
      .select("user_id").eq("password_digest", digest).maybeSingle();
    if (collision && collision.user_id !== user.id) {
      return reply({ error: "이미 사용 중인 비밀번호입니다. 다른 비밀번호를 선택해 주세요." }, 409);
    }

    const fingerprints = await passwordFingerprints(password, hmacSecret);
    const oldFingerprints = action === "change"
      ? await passwordFingerprints(String(body.oldPassword), hmacSecret)
      : [];
    const { data: fingerprintsReserved, error: fingerprintError } = await service.rpc(
      "reserve_risk_game_recovery_fingerprints",
      { p_user_id: user.id, p_fingerprints: fingerprints },
    );
    if (fingerprintError) {
      return reply({ error: "복구 비밀번호 유사성 검사 기능이 준비되지 않았습니다. 잠시 후 다시 시도하세요." }, 503);
    }
    if (fingerprintsReserved !== true) {
      return reply({
        error: "다른 복구 비밀번호와 8자 이상 연속으로 겹칩니다. 다른 비밀번호를 선택해 주세요.",
        code: "RECOVERY_PASSWORD_OVERLAP",
      }, 409);
    }

    const { error: updateError } = await service.auth.admin.updateUserById(user.id, {
      email, password, email_confirm: true,
    });
    if (updateError) {
      // Keep the prior fingerprints if changing failed; a failed new registration leaves none.
      await service.rpc("keep_risk_game_recovery_fingerprints", {
        p_user_id: user.id, p_fingerprints: oldFingerprints,
      });
      return reply({ error: "복구 로그인 설정에 실패했습니다." }, 500);
    }

    const { error: saveError } = await service.from("risk_game_recovery_credentials").upsert({
      user_id: user.id, password_digest: digest, synthetic_email: email, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (saveError) {
      // Keep both old and new fingerprints until the credential record is repaired; this fails closed.
      return reply({ error: "복구 정보 저장에 실패했습니다. 새 비밀번호로 다시 로그인해 확인해 주세요." }, 500);
    }

    const { error: cleanupError } = await service.rpc("keep_risk_game_recovery_fingerprints", {
      p_user_id: user.id, p_fingerprints: fingerprints,
    });
    if (cleanupError) {
      // Leaving extra fingerprints is restrictive but does not expose an account.
      console.error("Recovery fingerprint cleanup failed:", cleanupError);
    }
    return reply({ ok: true });
  }

  if (action === "save_state") {
    const payload = body.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return reply({ error: "게임 데이터를 확인할 수 없습니다." }, 400);
    }
    const { error } = await service.from("risk_game_saves").upsert({
      user_id: user.id, payload, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) return reply({ error: "게임 데이터 동기화에 실패했습니다." }, 500);
    return reply({ ok: true });
  }

  if (action === "load_state") {
    const { data, error } = await service.from("risk_game_saves")
      .select("payload, updated_at").eq("user_id", user.id).maybeSingle();
    if (error) return reply({ error: "게임 데이터를 불러오지 못했습니다." }, 500);
    return reply({ payload: data?.payload ?? null, updated_at: data?.updated_at ?? null });
  }

  return reply({ error: "알 수 없는 작업입니다." }, 400);
});
