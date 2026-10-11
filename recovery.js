/* Risk Game recovery password + cross-device save sync. */
(() => {
  "use strict";
  const config = window.RISK_GAME_SUPABASE_CONFIG || {};
  const $ = id => document.getElementById(id);
  let client = null;
  let saveTimer = null;
  let restoreInProgress = false;

  const RECOVERY_ENABLED_KEY = "risk-game-recovery-enabled-v1";
  const DEVICE_ID_KEY = "risk-game-device-id-v1";
  const DISPLACED_KEY = "risk-game-account-displaced-v1";
  let deviceVerified = false;
  let displacementHandled = false;
  let deviceCheckInProgress = false;

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }

  function handleDeviceDisplaced() {
    if (displacementHandled) return;
    displacementHandled = true;
    deviceVerified = false;

    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    // 이 기기에서만 세션을 종료합니다. global 로그아웃은 새 기기까지 끊을 수 있습니다.
    localStorage.removeItem(RECOVERY_ENABLED_KEY);
    localStorage.setItem(DISPLACED_KEY, "true");
    try {
      const signOut = client?.auth.signOut({ scope: "local" });
      signOut?.catch(error => console.warn("이전 기기 로그아웃 실패:", error));
    } catch (error) {
      console.warn("이전 기기 로그아웃 실패:", error);
    }

    // 화면을 즉시 계정 선택으로 돌리고, 현재 기기의 계정 데이터 정리는 script.js에서 처리합니다.
    window.dispatchEvent(new Event("risk-game-account-displaced"));
  }

  async function verifyDeviceSession() {
    if (!client || localStorage.getItem(DISPLACED_KEY) === "true") return false;

    const { data, error } = await client.auth.getSession();
    if (error) throw error;

    if (!data?.session?.user) {
      // 복구 계정으로 사용 중이던 기기의 세션이 사라졌다면 처음 화면으로 되돌립니다.
      if (localStorage.getItem(RECOVERY_ENABLED_KEY) === "true") {
        handleDeviceDisplaced();
      }
      return false;
    }

    try {
      const result = await invoke("check_device", { deviceId: getDeviceId() });
      if (result.active !== true) {
        handleDeviceDisplaced();
        return false;
      }
      deviceVerified = true;
      displacementHandled = false;
      return true;
    } catch (error) {
      const detail = String(error?.message || "").toLowerCase();
      // 인증 만료/취소는 소유권 확인 실패로 처리하되, 일시적인 네트워크 오류는 로그아웃시키지 않습니다.
      if (
        detail.includes("401") ||
        detail.includes("unauthorized") ||
        detail.includes("invalid jwt") ||
        detail.includes("not authenticated") ||
        detail.includes("로그인된 계정이 필요") ||
        detail.includes("계정을 확인할 수 없습니다")
      ) {
        handleDeviceDisplaced();
        return false;
      }
      throw error;
    }
  }

  function message(id, text, isError = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("recovery-error", Boolean(isError));
  }

  function passwordValid(value) {
    return typeof value === "string" && value.length >= 10 && value.length <= 128;
  }

  async function invoke(action, extra = {}) {
    if (!client) throw new Error("온라인 계정 연결을 준비하지 못했습니다. 인터넷 연결을 확인하세요.");
    const { data, error } = await client.functions.invoke("risk-game-recovery", {
      body: { action, ...extra }
    });
    if (error) {
      let detail = "";
      try {
        detail = error.context && typeof error.context.json === "function"
          ? String((await error.context.json())?.error || "")
          : "";
      } catch {}
      throw new Error(detail || error.message || "서버 요청에 실패했습니다.");
    }
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  function setBusy(ids, busy) {
    ids.forEach(id => {
      const button = $(id);
      if (button) button.disabled = busy;
    });
  }

  async function setupPassword() {
    const password = $("setupRecoveryPassword").value;
    const confirm = $("setupRecoveryPasswordConfirm").value;
    if (!passwordValid(password)) {
      message("setupRecoveryMessage", "비밀번호는 10~128자로 입력하세요.", true);
      return;
    }
    if (password !== confirm) {
      message("setupRecoveryMessage", "두 비밀번호가 일치하지 않습니다.", true);
      return;
    }

    setBusy(["saveRecoverySetupButton", "skipRecoverySetupButton"], true);
    message("setupRecoveryMessage", "복구 비밀번호를 안전하게 등록하고 있습니다.");
    try {
      const deviceId = getDeviceId();
      await invoke("claim_device", { deviceId });
      await invoke("register", { password, deviceId });
      localStorage.removeItem(DISPLACED_KEY);
      localStorage.setItem(RECOVERY_ENABLED_KEY, "true");
      deviceVerified = true;
      $("recoverySetupModal").classList.add("hidden");
      const entryPanel = $("recoverySetupEntryPanel");
      if (entryPanel) entryPanel.classList.add("hidden");
      $("setupRecoveryPassword").value = "";
      $("setupRecoveryPasswordConfirm").value = "";
      await saveCloudState();
      message("changeRecoveryMessage", "복구 비밀번호가 설정되었습니다.");
      message("setupRecoveryMessage", "");
    } catch (error) {
      message("setupRecoveryMessage", String(error?.message || "등록에 실패했습니다."), true);
    } finally {
      setBusy(["saveRecoverySetupButton", "skipRecoverySetupButton"], false);
    }
  }

  async function changePassword() {
    const oldPassword = $("recoveryOldPassword").value;
    const password = $("recoveryNewPassword").value;
    const confirm = $("recoveryNewPasswordConfirm").value;
    if (!passwordValid(oldPassword)) {
      message("changeRecoveryMessage", "기존 비밀번호를 입력하세요.", true);
      return;
    }
    if (!passwordValid(password)) {
      message("changeRecoveryMessage", "새 비밀번호는 10~128자로 입력하세요.", true);
      return;
    }
    if (password !== confirm) {
      message("changeRecoveryMessage", "새 비밀번호 두 칸이 일치하지 않습니다.", true);
      return;
    }
    setBusy(["changeRecoveryPasswordButton"], true);
    message("changeRecoveryMessage", "비밀번호를 변경하고 있습니다.");
    try {
      const deviceId = getDeviceId();
      await invoke("change", { oldPassword, password, deviceId });
      localStorage.setItem(RECOVERY_ENABLED_KEY, "true");
      $("recoveryOldPassword").value = "";
      $("recoveryNewPassword").value = "";
      $("recoveryNewPasswordConfirm").value = "";
      message("changeRecoveryMessage", "복구 비밀번호가 변경되었습니다.");
    } catch (error) {
      message("changeRecoveryMessage", String(error?.message || "변경에 실패했습니다."), true);
    } finally {
      setBusy(["changeRecoveryPasswordButton"], false);
    }
  }

  async function restoreAccount() {
    if (restoreInProgress) return;
    const password = $("restoreRecoveryPassword").value;
    if (!passwordValid(password)) {
      message("restoreRecoveryMessage", "복구 비밀번호를 10자 이상 입력하세요.", true);
      return;
    }

    restoreInProgress = true;
    setBusy(["restoreRecoveryAccountButton"], true);
    message("restoreRecoveryMessage", "계정을 확인하고 있습니다. 복구가 완료되면 기존 기기는 계정 선택 화면으로 돌아갑니다.");
    let deviceClaimed = false;
    try {
      const found = await invoke("lookup", { password });
      if (!found.email) throw new Error("복구 비밀번호가 일치하는 계정을 찾지 못했습니다.");

      const { data, error } = await client.auth.signInWithPassword({
        email: found.email,
        password
      });
      if (error) throw error;
      if (!data?.user || !data?.session) throw new Error("계정 로그인 응답을 확인할 수 없습니다.");

      const deviceId = getDeviceId();
      // 권한 이전 뒤 데이터 로드가 실패해도 같은 기기에서 복구를 재시도할 수 있습니다.
      await invoke("claim_device", { deviceId, password });
      deviceClaimed = true;
      const result = await invoke("load_state", { deviceId });
      if (result.payload && typeof window.riskGameApplyCloudState === "function") {
        const applied = window.riskGameApplyCloudState(result.payload);
        if (!applied) throw new Error("계정은 연결됐지만 게임 데이터를 적용하지 못했습니다. 현재 기기 데이터는 그대로 남아 있습니다.");
        $("restoreRecoveryPassword").value = "";
        message("restoreRecoveryMessage", "계정과 게임 진행 데이터를 복구했습니다.");
      } else {
        $("restoreRecoveryPassword").value = "";
        message("restoreRecoveryMessage", "계정은 복구했지만 서버에 저장된 게임 데이터가 없어 현재 기기의 게임 데이터는 유지했습니다.");
      }
      localStorage.removeItem(DISPLACED_KEY);
      localStorage.setItem(RECOVERY_ENABLED_KEY, "true");
      deviceVerified = true;
      displacementHandled = false;
      if (!result.payload) await saveCloudState();
      window.dispatchEvent(new Event("risk-game-account-restored"));
    } catch (error) {
      const detail = String(error?.message || "계정 복구에 실패했습니다.");
      // 기기 권한을 이전한 뒤 오류가 나면 권한을 되돌리려 하지 않습니다.
      // 같은 기기에서 다시 시도하면 해당 기기가 현재 소유 기기이므로 데이터 로드를 재시도할 수 있습니다.
      message("restoreRecoveryMessage",
        deviceClaimed
          ? "기기 연결은 완료됐지만 데이터 복구가 끝나지 않았습니다. 데이터는 서버에 남아 있습니다. 같은 기기에서 계정 복구를 다시 눌러 재시도하세요. (" + detail + ")"
          : detail,
        true);
    } finally {
      restoreInProgress = false;
      setBusy(["restoreRecoveryAccountButton"], false);
    }
  }

  let accountDeletionInProgress = false;

  function clearLocalAccountAfterDeletion() {
    deviceVerified = false;
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    // 서버에서 이미 삭제된 계정의 오래된 로그인 정보가 남아 있는 경우도 정리합니다.
    try { client?.auth.signOut({ scope: "local" }).catch(() => {}); } catch {}

    const keysToRemove = [];
    const projectUrl = String(config.url || window.RISK_GAME_SUPABASE_CONFIG?.url || "");
    let projectRef = "";
    try { projectRef = new URL(projectUrl).hostname.split(".")[0]; } catch {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith("risk-game-") ||
          ["riskGameState", "risk-game", "riskGame", "gameState"].includes(key) ||
          (projectRef && key.startsWith("sb-" + projectRef + "-"))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    // 앱을 다시 시작해 신규 / 기존 계정 선택 화면으로 진입시킵니다.
    window.location.replace("./");
  }

  async function deleteCurrentAccount() {
    if (accountDeletionInProgress) return;
    const button = $("deleteAccountButton");
    const status = $("deleteAccountMessage");
    if (!client) {
      if (status) {
        status.textContent = "온라인 계정 서버에 연결되지 않았습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.";
        status.classList.add("recovery-error");
      }
      return;
    }

    accountDeletionInProgress = true;
    if (button) button.disabled = true;
    if (status) {
      status.textContent = "계정과 관련 데이터를 영구 삭제하고 있습니다. 화면을 닫지 마세요.";
      status.classList.remove("recovery-error");
    }

    try {
      await invoke("delete_account", { deviceId: getDeviceId() });
      clearLocalAccountAfterDeletion();
    } catch (error) {
      const detail = String(error?.message || "계정 삭제에 실패했습니다.");

      // A stale access token can no longer identify a user that was deleted elsewhere.
      // Ask for the recovery password and let the server verify the exact old user ID.
      if (detail.includes("계정을 확인할 수 없습니다")) {
        let staleUserId = "";
        try {
          const { data } = await client.auth.getSession();
          staleUserId = data?.session?.user?.id || "";
        } catch {}
        if (staleUserId) {
          const password = window.prompt(
            "이 기기의 계정 로그인 정보가 만료되었거나 서버에서 계정을 찾지 못했습니다.\n\n계정 소유자 확인을 위해 해당 계정의 복구 비밀번호를 입력하세요.\n계정이 이미 삭제되었다면 서버 확인 후 이 기기의 오래된 정보만 정리합니다."
          );
          if (password !== null) {
            try {
              await invoke("delete_account_with_recovery_password", { staleUserId, password });
              clearLocalAccountAfterDeletion();
              return;
            } catch (fallbackError) {
              if (status) {
                status.textContent = String(fallbackError?.message || "복구 비밀번호로 계정을 확인하지 못했습니다.");
                status.classList.add("recovery-error");
              }
            }
          } else if (status) {
            status.textContent = "삭제 확인이 취소되었습니다. 계정은 변경하지 않았습니다.";
            status.classList.add("recovery-error");
          }
        } else if (status) {
          status.textContent = "기존 계정 정보를 찾지 못했습니다. 기존 계정 복구 화면에서 복구 비밀번호로 다시 연결해 주세요.";
          status.classList.add("recovery-error");
        }
      }
      if (!detail.includes("계정을 확인할 수 없습니다") && status) {
        status.textContent = detail + " 계정은 삭제되지 않았을 수 있으므로 화면을 확인한 뒤 다시 시도하세요.";
        status.classList.add("recovery-error");
      }
      accountDeletionInProgress = false;
      if (button) button.disabled = false;
    }
  }

  window.riskGameDeleteAccount = deleteCurrentAccount;

  // 계정은 서버에서 삭제하지 않고, 현재 기기의 세션과 로컬 데이터만 정리합니다.
  window.riskGameLeaveAccount = () => {
    const status = $("leaveAccountMessage");
    if (!client) {
      if (status) {
        status.textContent = "온라인 계정 서버에 연결되지 않았습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.";
        status.classList.add("recovery-error");
      }
      return false;
    }
    if (localStorage.getItem(RECOVERY_ENABLED_KEY) !== "true") {
      if (status) {
        status.textContent = "계정을 나가기 전에 먼저 '복구 비밀번호 설정'에서 복구 비밀번호를 설정하세요. 설정하지 않으면 계정을 다시 찾지 못할 수 있습니다.";
        status.classList.add("recovery-error");
      }
      return false;
    }
    if (restoreInProgress || accountDeletionInProgress) {
      if (status) {
        status.textContent = "계정 작업이 진행 중입니다. 잠시 후 다시 시도하세요.";
        status.classList.add("recovery-error");
      }
      return false;
    }
    handleDeviceDisplaced();
    return true;
  };

  async function saveCloudState() {
    if (!client || !deviceVerified || localStorage.getItem(RECOVERY_ENABLED_KEY) !== "true" ||
        typeof window.riskGameGetState !== "function") return;
    try {
      await invoke("save_state", { payload: window.riskGameGetState(), deviceId: getDeviceId() });
    } catch (error) {
      console.error("게임 데이터 클라우드 저장 실패:", error);
      if (String(error?.message || "").includes("다른 기기에서 이 계정을 복구했습니다")) {
        handleDeviceDisplaced();
      }
    }
  }

  function scheduleCloudSave() {
    if (restoreInProgress || !deviceVerified || localStorage.getItem(RECOVERY_ENABLED_KEY) !== "true") return;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveCloudState();
    }, 1800);
  }

  function openInitialSetup() {
    const modal = $("recoverySetupModal");
    if (!modal || localStorage.getItem(RECOVERY_ENABLED_KEY) === "true") return;
    $("setupRecoveryPassword").value = "";
    $("setupRecoveryPasswordConfirm").value = "";
    message("setupRecoveryMessage", "");
    modal.classList.remove("hidden");
    $("setupRecoveryPassword").focus();
  }

  function init() {
    if (window.riskGameSupabaseClient) {
      client = window.riskGameSupabaseClient;
    } else if (config.url && config.anonKey && window.supabase?.createClient) {
      client = window.supabase.createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
    }

    // 테스트용 로그아웃 진입점에서 Supabase의 로컬 세션도 종료합니다.
    if (localStorage.getItem("risk-game-force-local-logout-v1") === "true") {
      localStorage.removeItem("risk-game-force-local-logout-v1");
      if (client) {
        client.auth.signOut().catch(error => {
          console.warn("테스트 로그아웃 세션 정리 실패:", error);
        });
      }
    }

    $("saveRecoverySetupButton")?.addEventListener("click", setupPassword);
    $("openRecoverySetupButton")?.addEventListener("click", () => {
      if (localStorage.getItem(RECOVERY_ENABLED_KEY) === "true") {
        message("openRecoverySetupMessage", "이 기기에는 복구 기능이 이미 연결되어 있습니다. 아래의 복구 비밀번호 변경을 이용하세요.", true);
        return;
      }
      openInitialSetup();
    });
    if (localStorage.getItem(RECOVERY_ENABLED_KEY) === "true") {
      $("recoverySetupEntryPanel")?.classList.add("hidden");
    }
    $("skipRecoverySetupButton")?.addEventListener("click", () => {
      $("recoverySetupModal").classList.add("hidden");
      message("setupRecoveryMessage", "");
    });
    $("changeRecoveryPasswordButton")?.addEventListener("click", changePassword);
    $("restoreRecoveryAccountButton")?.addEventListener("click", restoreAccount);

    ["setupRecoveryPassword", "setupRecoveryPasswordConfirm"].forEach(id => {
      $(id)?.addEventListener("keydown", event => {
        if (event.key === "Enter") setupPassword();
      });
    });
    $("recoveryNewPasswordConfirm")?.addEventListener("keydown", event => {
      if (event.key === "Enter") changePassword();
    });
    $("restoreRecoveryPassword")?.addEventListener("keydown", event => {
      if (event.key === "Enter") restoreAccount();
    });

    window.addEventListener("risk-game-initial-profile-created", openInitialSetup);
    window.addEventListener("risk-game-state-updated", scheduleCloudSave);
    window.addEventListener("pagehide", saveCloudState);
    const recheckDeviceAndSync = async (syncState = true) => {
      if (document.visibilityState === "hidden" ||
          localStorage.getItem(DISPLACED_KEY) === "true" ||
          restoreInProgress ||
          deviceCheckInProgress) return;
      deviceCheckInProgress = true;
      try {
        if (await verifyDeviceSession() && syncState) await saveCloudState();
      } catch (error) {
        // 연결 오류만으로 계정 소유권을 바꾸거나 로컬 데이터를 지우지 않습니다.
        console.warn("기기 연결 상태 확인 실패:", error);
      } finally {
        deviceCheckInProgress = false;
      }
    };
    document.addEventListener("visibilitychange", () => recheckDeviceAndSync(true));
    window.addEventListener("pageshow", () => recheckDeviceAndSync(true));
    window.addEventListener("focus", () => recheckDeviceAndSync(true));

    // 로그인된 계정의 기기 소유권을 계속 확인합니다.
    // 다른 기기에서 복구하면 화면이 열려 있는 동안 약 2초 안에 로그아웃됩니다.
    window.setInterval(() => {
      if (document.visibilityState === "visible") recheckDeviceAndSync(false);
    }, 2000);

    if (localStorage.getItem(RECOVERY_ENABLED_KEY) === "true") {
      window.setTimeout(() => recheckDeviceAndSync(true), 100);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
