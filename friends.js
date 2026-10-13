/* Risk Game: Supabase account + friend list.
   Requires supabase-config.js and the Supabase v2 browser library.
*/
(() => {
  "use strict";

  const config = window.RISK_GAME_SUPABASE_CONFIG || {};
  const configured =
    typeof config.url === "string" &&
    /^https:\/\//.test(config.url) &&
    !config.url.includes("YOUR_SUPABASE") &&
    typeof config.anonKey === "string" &&
    config.anonKey.length > 20 &&
    !config.anonKey.includes("YOUR_SUPABASE");

  const $ = id => document.getElementById(id);
  let client = null;
  let currentUser = null;
  let initialProfileCreationInProgress = false;
  let connectionErrorMessage = "";
  let connectingPromise = null;
  let busy = false;
  let syncedUserId = null;
  let renderedRequestsSignature = null;
  let latestRequestIds = [];
  let renderedFriendsSignature = null;
  let presenceSyncInProgress = false;
  let presenceSyncPending = false;
  let lastPresenceSyncAt = 0;


  function friendRequestSeenStorageKey() {
    return currentUser ? "risk-game-seen-friend-requests:" + currentUser.id : "";
  }

  function getSeenFriendRequestIds() {
    const key = friendRequestSeenStorageKey();
    if (!key) return new Set();
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "[]");
      return new Set(Array.isArray(saved) ? saved.map(String) : []);
    } catch {
      return new Set();
    }
  }

  function updateFriendRequestDot(show) {
    const dot = $("friendRequestNotificationDot");
    const button = $("openNotificationsButton");
    if (dot) dot.classList.toggle("hidden", !show);
    if (button) button.setAttribute("aria-label", show ? "알림, 새 친구 요청 있음" : "알림 열기");
  }

  function markFriendRequestsSeen(ids = latestRequestIds) {
    const key = friendRequestSeenStorageKey();
    if (!key) {
      updateFriendRequestDot(false);
      return;
    }
    const seen = getSeenFriendRequestIds();
    ids.forEach(id => seen.add(String(id)));
    try { localStorage.setItem(key, JSON.stringify(Array.from(seen))); } catch {}
    updateFriendRequestDot(false);
  }

  function refreshFriendRequestDot(requests) {
    latestRequestIds = requests.map(request => String(request.id));
    const requestsModal = $("friendRequestsModal");
    if (!client || !currentUser) {
      updateFriendRequestDot(false);
      return;
    }
    if (requestsModal && !requestsModal.classList.contains("hidden")) {
      // 알림 창을 보고 있을 때 도착한 요청도 확인한 것으로 처리합니다.
      markFriendRequestsSeen(latestRequestIds);
      return;
    }
    const seen = getSeenFriendRequestIds();
    updateFriendRequestDot(latestRequestIds.some(id => !seen.has(id)));
  }

  function withTimeout(promise, label, milliseconds = 12000) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(label + " 요청이 12초 이상 응답하지 않습니다. 인터넷 연결과 Supabase 설정을 확인하세요.")), milliseconds);
      })
    ]).finally(() => window.clearTimeout(timer));
  }

  function setMessage(message, isError = false) {
    const el = $("friendMessage");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("friend-error", Boolean(isError));
  }

  function setBusy(value) {
    busy = value;
    ["addFriendButton", "refreshFriendsButton"]
      .forEach(id => {
        const button = $(id);
        if (button) button.disabled = value;
      });
    document.querySelectorAll("#friendRequests button").forEach(button => { button.disabled = value; });
  }

  function localProfile() {
    try {
      const value = JSON.parse(localStorage.getItem("risk-game-profile-v1") || "null");
      return value && typeof value.name === "string" ? value : { name: "플레이어", code: "" };
    } catch {
      return { name: "플레이어", code: "" };
    }
  }

  function saveCloudProfileLocally(profile) {
    try {
      if (typeof window.riskGameApplyCloudProfile === "function") {
        window.riskGameApplyCloudProfile(profile);
      } else {
        localStorage.setItem("risk-game-profile-v1", JSON.stringify({
          name: profile.display_name,
          code: profile.friend_code
        }));
      }
      $("friendMyCode").textContent = profile.display_name + "#" + profile.friend_code;
      return true;
    } catch (error) {
      console.error("프로필 표시 동기화 실패:", error);
      return null;
    }
  }

  function updateAccountUi() {
    const connected = Boolean(currentUser);
    const status = $("friendCloudStatus");
    if (status) {
      status.textContent = !configured
        ? "온라인 연결 설정을 확인해야 합니다."
        : connected
          ? "온라인 연결됨 · 이름과 고유 코드는 유지됩니다."
          : "온라인 친구 기능 연결 중...";
    }
  }

  async function fetchMyProfile() {
    if (!client || !currentUser) return null;

    // 계정이 바뀌었을 때 먼저 기존 서버 프로필을 확인합니다.
    // 복구한 계정의 이름/코드를 이 기기의 임시 프로필로 덮어쓰지 않습니다.
    if (syncedUserId !== currentUser.id) {
      const { data: existingProfile, error: existingProfileError } = await client
        .from("profiles")
        .select("id")
        .eq("id", currentUser.id)
        .maybeSingle();
      if (existingProfileError) throw existingProfileError;

      if (!existingProfile) {
        const local = localProfile();
        const { error: syncError } = await client.rpc("sync_risk_game_profile", {
          p_name: String(local.name || "플레이어").trim().slice(0, 20) || "플레이어",
          p_code: String(local.code || "")
        });
        if (syncError) throw syncError;
      }
      syncedUserId = currentUser.id;
    }

    const { data, error } = await client
      .from("profiles")
      .select("id, display_name, friend_code")
      .eq("id", currentUser.id)
      .single();
    if (error) throw error;
    saveCloudProfileLocally(data);
    $("friendMyCode").textContent = data.display_name + "#" + data.friend_code;
    return data;
  }

  function isFriendOnline(friend) {
    if (!friend.last_seen_at) return false;
    const lastSeen = Date.parse(friend.last_seen_at);
    return Number.isFinite(lastSeen) && Date.now() - lastSeen <= 30000;
  }

  function formatFriendMoney(value) {
    const amount = Number(value);
    return (Number.isFinite(amount) && amount >= 0 ? Math.floor(amount) : 0)
      .toLocaleString("ko-KR") + "원";
  }

  function makeFriendRow(friend) {
    const row = document.createElement("div");
    row.className = "friend-row";

    const details = document.createElement("div");
    details.className = "friend-row-details";

    const nameLine = document.createElement("div");
    nameLine.className = "friend-name-line";

    const online = isFriendOnline(friend);
    const dot = document.createElement("span");
    dot.className = "friend-presence-dot" + (online ? " is-online" : "");
    dot.setAttribute("aria-label", online ? "앱 사용 중" : "앱 사용 중 아님");
    dot.title = online ? "앱 사용 중" : "앱 사용 중 아님";

    const name = document.createElement("strong");
    name.textContent = friend.display_name;
    nameLine.append(dot, name);

    const code = document.createElement("span");
    code.textContent = "#" + friend.friend_code;

    const budget = document.createElement("span");
    budget.className = "friend-budget";
    budget.textContent = "예산 " + formatFriendMoney(friend.current_budget);

    details.append(nameLine, code, budget);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "friend-remove-button";
    remove.textContent = "삭제";
    remove.setAttribute("aria-label", friend.display_name + " 친구 삭제");
    remove.addEventListener("click", () => removeFriend(friend.id, friend.display_name));

    row.append(details, remove);
    return row;
  }

  function makeRequestRow(request) {
    const row = document.createElement("div");
    row.className = "friend-row friend-request-row";
    const details = document.createElement("div");
    details.className = "friend-row-details";
    const name = document.createElement("strong");
    name.textContent = request.sender_name || "이름 없는 플레이어";
    const code = document.createElement("span");
    code.textContent = "#" + (request.sender_code || "----");
    const note = document.createElement("span");
    note.textContent = "친구 요청을 보냈습니다.";
    details.append(name, code, note);
    const actions = document.createElement("div");
    actions.className = "friend-request-actions";
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "friend-request-accept";
    accept.textContent = "수락";
    accept.disabled = busy;
    accept.addEventListener("click", () => respondToRequest(request.id, true));
    const decline = document.createElement("button");
    decline.type = "button";
    decline.className = "friend-request-decline";
    decline.textContent = "거절";
    decline.disabled = busy;
    decline.addEventListener("click", () => respondToRequest(request.id, false));
    actions.append(accept, decline);
    row.append(details, actions);
    return row;
  }

  async function loadRequests() {
    const list = $("friendRequests");
    if (!list) return;

    if (!client || !currentUser) {
      latestRequestIds = [];
      const signature = "offline";
      if (renderedRequestsSignature !== signature) {
        const empty = document.createElement("p");
        empty.className = "muted friend-empty";
        empty.textContent = "온라인 연결 후 받은 친구 요청을 확인할 수 있습니다.";
        list.replaceChildren(empty);
        renderedRequestsSignature = signature;
      }
      return;
    }

    // 새 데이터를 다 가져온 뒤 실제 내용이 바뀐 경우에만 DOM을 갱신합니다.
    // 주기적인 확인 때마다 요소를 지웠다 다시 만들면 모바일 스크롤이 튀거나 깜빡일 수 있습니다.
    const { data: requests, error } = await client
      .from("friend_requests")
      .select("id, sender_id, sender_name, sender_code, created_at")
      .eq("receiver_id", currentUser.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw error;

    const rows = requests || [];
    refreshFriendRequestDot(rows);
    const signature = currentUser.id + ":" + JSON.stringify(rows.map(request => [
      request.id, request.sender_id, request.sender_name, request.sender_code
    ]));
    if (signature === renderedRequestsSignature) return;

    const fragment = document.createDocumentFragment();
    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted friend-empty";
      empty.textContent = "새로운 친구 요청이 없습니다.";
      fragment.append(empty);
    } else {
      rows.forEach(request => fragment.append(makeRequestRow(request)));
    }
    list.replaceChildren(fragment);
    renderedRequestsSignature = signature;
  }

  async function syncMyPresence(force = false) {
    if (!client || !currentUser || document.visibilityState !== "visible") return;
    const now = Date.now();
    if (presenceSyncInProgress) {
      // 예산이 바뀌는 동안 이전 동기화가 진행 중이면 최신 예산을 한 번 더 전송합니다.
      if (force) presenceSyncPending = true;
      return;
    }
    if (!force && now - lastPresenceSyncAt < 9000) return;
    presenceSyncInProgress = true;
    lastPresenceSyncAt = now;
    try {
      const budget = typeof window.riskGameGetBudget === "function"
        ? window.riskGameGetBudget()
        : 0;
      const safeBudget = Number.isFinite(Number(budget))
        ? Math.max(0, Math.floor(Number(budget)))
        : 0;
      const { error } = await client.rpc("sync_risk_game_presence", {
        p_budget: safeBudget
      });
      if (error) throw error;
    } catch (error) {
      console.error("온라인 상태/예산 동기화 실패:", error);
    } finally {
      presenceSyncInProgress = false;
      if (presenceSyncPending) {
        presenceSyncPending = false;
        window.setTimeout(() => syncMyPresence(true), 0);
      }
    }
  }

  async function loadFriends() {
    const list = $("friendList");
    if (!list) return;

    if (!client || !currentUser) {
      const signature = "offline";
      if (renderedFriendsSignature !== signature) {
        const empty = document.createElement("p");
        empty.className = "muted friend-empty";
        empty.textContent = "온라인 연결 후 친구 목록을 불러올 수 있습니다.";
        list.replaceChildren(empty);
        renderedFriendsSignature = signature;
      }
      return;
    }

    const { data: links, error: linksError } = await client
      .from("user_friends")
      .select("friend_id")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: true });

    if (linksError) throw linksError;

    const ids = (links || []).map(item => item.friend_id);
    let profiles = [];
    if (ids.length) {
      const { data, error: profilesError } = await client
        .from("profiles")
        .select("id, display_name, friend_code, current_budget, last_seen_at")
        .in("id", ids);

      if (profilesError) throw profilesError;
      const byId = new Map((data || []).map(profile => [profile.id, profile]));
      profiles = ids.map(id => byId.get(id)).filter(Boolean);
    }

    const signature = currentUser.id + ":" + JSON.stringify(profiles.map(friend => [
      friend.id,
      friend.display_name,
      friend.friend_code,
      Number(friend.current_budget) || 0,
      isFriendOnline(friend)
    ]));
    if (signature === renderedFriendsSignature) return;

    const fragment = document.createDocumentFragment();
    if (!profiles.length) {
      const empty = document.createElement("p");
      empty.className = "muted friend-empty";
      empty.textContent = "아직 추가한 친구가 없습니다.";
      fragment.append(empty);
    } else {
      profiles.forEach(friend => fragment.append(makeFriendRow(friend)));
    }
    list.replaceChildren(fragment);
    renderedFriendsSignature = signature;
  }

  async function refreshFriendLists() {
    const button = $("refreshFriendsButton");
    if (busy) return;
    setBusy(true);
    setMessage("");
    if (button) button.textContent = "새로고침 중...";
    try {
      if (!client || !currentUser) {
        const connected = await reconnectOnline();
        if (!connected || !currentUser) {
          throw new Error("온라인 연결에 실패했습니다. 잠시 후 다시 시도하세요.");
        }
      }
      await syncMyPresence(true);
      await Promise.all([loadFriends(), loadRequests()]);
      setMessage("친구 목록과 받은 친구 요청을 새로고침했습니다.");
    } catch (error) {
      console.error("친구 목록 수동 새로고침 실패:", error);
      setMessage("새로고침에 실패했습니다: " + String(error?.message || "알 수 없는 오류"), true);
    } finally {
      if (button) button.textContent = "새로고침";
      setBusy(false);
    }
  }

  async function refreshCloudData() {
    if (!client || !currentUser) {
      updateAccountUi();
      await loadFriends();
      return;
    }
    try {
      await fetchMyProfile();
      await syncMyPresence(true);
      await loadFriends();
      await loadRequests();
      updateAccountUi();
    } catch (error) {
      console.error("친구 데이터 동기화 실패:", error);
      setMessage("친구 데이터를 불러오지 못했습니다: " + String(error?.message || "알 수 없는 오류"), true);
      throw error;
    }
  }

  async function handleAuthState(session) {
    currentUser = session?.user || null;
    updateAccountUi();
    if (currentUser) {
      await refreshCloudData();
    } else {
      await loadFriends();
      await loadRequests();
      setMessage("");
    }
  }

  async function reconnectOnline() {
    if (currentUser) return true;
    if (!configured || !client) {
      connectionErrorMessage = "Supabase 설정 또는 라이브러리를 확인할 수 없습니다.";
      setMessage(connectionErrorMessage, true);
      return false;
    }
    if (connectingPromise) return connectingPromise;
    connectingPromise = (async () => {
      try {
        setMessage("온라인 계정에 다시 연결하고 있습니다...");
        const { data, error } = await withTimeout(client.auth.getSession(), "온라인 계정 확인");
        if (error) throw error;
        if (data.session?.user) {
          currentUser = data.session.user;
        } else {
          throw new Error("온라인 계정이 연결되어 있지 않습니다. 신규 계정을 등록하거나 기존 계정 복구를 진행하세요.");
        }
        connectionErrorMessage = "";
        updateAccountUi();
        await withTimeout(refreshCloudData(), "내 이름과 고유 코드 불러오기");
        if (!currentUser) throw new Error("온라인 사용자 정보가 유지되지 않았습니다. 페이지를 새로고침해 다시 시도하세요.");
        setMessage("");
        return true;
      } catch (error) {
        console.error("온라인 계정 재연결 실패:", error);
        connectionErrorMessage = String(error?.message || "알 수 없는 연결 오류");
        const lower = connectionErrorMessage.toLowerCase();
        if (lower.includes("anonymous") || lower.includes("disabled")) {
          connectionErrorMessage = "익명 로그인이 거부되었습니다. Supabase Authentication 설정에서 Anonymous Sign-Ins가 활성화되어 있는지 확인하세요. 원인: " + connectionErrorMessage;
        }
        setMessage("온라인 연결 실패: " + connectionErrorMessage, true);
        const status = $("friendCloudStatus");
        if (status) status.textContent = "온라인 연결 실패";
        const code = $("friendMyCode");
        if (code && (code.textContent === "불러오는 중..." || code.textContent === "연결 실패")) code.textContent = "연결 실패";
        return false;
      } finally {
        connectingPromise = null;
      }
    })();
    return connectingPromise;
  }

  async function addFriend() {
    if (busy) return;
    if (!client || !currentUser) {
      const connected = await reconnectOnline();
      if (!connected || !currentUser) {
        return setMessage("온라인 계정에 연결되지 않아 친구 요청을 보낼 수 없습니다. 연결 오류: " + (connectionErrorMessage || "오류 메시지 없음"), true);
      }
    }
    const name = $("friendNameInput").value.trim();
    const code = $("friendCodeOnlyInput").value.trim();
    if (!name) return setMessage("친구 이름을 입력하세요.", true);
    if (!/^\d{4}$/.test(code)) return setMessage("고유 코드는 숫자 4자리로 입력하세요.", true);
    if (!name || name.length > 20) return setMessage("이름을 확인하세요.", true);

    setBusy(true);
    setMessage("");
    try {
      const { data: matches, error: lookupError } = await client.rpc(
        "lookup_risk_game_friend", { p_name: name, p_code: code }
      );
      if (lookupError) throw lookupError;
      const target = Array.isArray(matches) ? matches[0] : matches;
      if (!target) return setMessage("일치하는 계정을 찾지 못했습니다. 이름과 4자리 코드를 확인하세요.", true);
      if (target.id === currentUser.id) return setMessage("자기 자신에게 친구 요청을 보낼 수 없습니다.", true);

      const { data: existingFriend, error: friendCheckError } = await client
        .from("user_friends").select("friend_id")
        .eq("user_id", currentUser.id).eq("friend_id", target.id).maybeSingle();
      if (friendCheckError) throw friendCheckError;
      if (existingFriend) return setMessage("이미 친구 목록에 있는 계정입니다.", true);

      const { data: incoming, error: incomingError } = await client
        .from("friend_requests").select("id")
        .eq("sender_id", target.id).eq("receiver_id", currentUser.id)
        .eq("status", "pending").limit(1);
      if (incomingError) throw incomingError;
      if (incoming && incoming.length) {
        await loadRequests();
        return setMessage("이 계정이 먼저 친구 요청을 보냈습니다. 아래 친구 요청에서 수락하거나 거절하세요.", true);
      }

      const me = await fetchMyProfile();
      if (!me) throw new Error("내 계정 정보를 불러오지 못했습니다.");
      const { error: insertError } = await client.from("friend_requests").insert({
        sender_id: currentUser.id,
        receiver_id: target.id,
        sender_name: me.display_name,
        sender_code: me.friend_code,
        status: "pending"
      });
      if (insertError?.code === "23505") {
        return setMessage("이미 보낸 친구 요청이 아직 처리되지 않았습니다.", true);
      }
      if (insertError) throw insertError;
      $("friendNameInput").value = "";
      $("friendCodeOnlyInput").value = "";
      setMessage(target.display_name + " 님에게 친구 요청을 보냈습니다. 상대방이 수락하면 서로 친구가 됩니다.");
    } catch (error) {
      console.error(error);
      setMessage(error.message || "친구 요청 전송에 실패했습니다. Supabase 설정을 확인하세요.", true);
    } finally {
      setBusy(false);
    }
  }

  async function respondToRequest(requestId, accept) {
    if (!client || !currentUser || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const functionName = accept ? "accept_risk_game_friend_request" : "decline_risk_game_friend_request";
      const { error } = await client.rpc(functionName, { p_request_id: requestId });
      if (error) throw error;
      await loadFriends();
      await loadRequests();
      setMessage(accept
        ? "친구 요청을 수락했습니다. 서로의 친구 목록에 등록되었습니다."
        : "친구 요청을 거절했습니다.");
    } catch (error) {
      console.error(error);
      setMessage(error.message || "친구 요청 처리에 실패했습니다. 다시 시도하세요.", true);
    } finally {
      setBusy(false);
    }
  }

  async function removeFriend(friendId, friendName) {
    if (!client || !currentUser || busy) return;
    if (!window.confirm(friendName + " 님을 친구 목록에서 삭제할까요?")) return;
    setBusy(true);
    try {
      const { error } = await client.rpc("remove_risk_game_friend", {
        p_friend_id: friendId
      });
      if (error) throw error;
      await loadFriends();
      setMessage(friendName + " 님을 친구 목록에서 삭제했습니다.");
    } catch (error) {
      setMessage("친구 삭제에 실패했습니다.", true);
    } finally {
      setBusy(false);
    }
  }

  async function updateCloudName(detail) {
    if (!client || !currentUser || !detail || !detail.name) return;
    try {
      const { error } = await client.from("profiles")
        .update({ display_name: detail.name.trim().slice(0, 20) })
        .eq("id", currentUser.id);
      if (error) throw error;
      await fetchMyProfile();
      await loadFriends();
    } catch (error) {
      console.error("온라인 계정 이름 동기화 실패:", error);
      setMessage("이름은 이 기기에 저장됐지만 온라인 계정 동기화에는 실패했습니다.", true);
    }
  }

  function init() {
    if (configured && window.supabase?.createClient) {
      client = window.supabase.createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
      window.riskGameSupabaseClient = client;
    }

    $("addFriendButton").addEventListener("click", addFriend);
    $("friendNameInput").addEventListener("keydown", event => {
      if (event.key === "Enter") $("friendCodeOnlyInput").focus();
    });
    $("friendCodeOnlyInput").addEventListener("keydown", event => {
      if (event.key === "Enter") addFriend();
    });
    $("friendMenuButton").addEventListener("click", async () => {
      if (!configured) {
        setMessage("온라인 연결 설정을 확인해야 합니다.", true);
      } else if (currentUser) {
        await refreshCloudData();
      } else {
        await reconnectOnline();
      }
    });

    const requestsModal = $("friendRequestsModal");
    const closeRequestsModal = () => requestsModal?.classList.add("hidden");
    $("openNotificationsButton").addEventListener("click", async () => {
      requestsModal?.classList.remove("hidden");
      // 알림 창을 열면 현재까지 도착한 요청의 빨간 점을 즉시 지웁니다.
      markFriendRequestsSeen();
      if (!configured) {
        const list = $("friendRequests");
        if (list) {
          const message = document.createElement("p");
          message.className = "muted friend-empty";
          message.textContent = "온라인 연결 설정을 확인해야 친구 요청을 불러올 수 있습니다.";
          list.replaceChildren(message);
        }
        return;
      }
      if (currentUser) {
        await refreshCloudData();
      } else {
        await reconnectOnline();
      }
      await loadRequests().catch(error => {
        console.error("알림의 친구 요청 불러오기 실패:", error);
      });
    });
    const closeAndRefreshRequestDot = () => {
      closeRequestsModal();
      const seen = getSeenFriendRequestIds();
      updateFriendRequestDot(latestRequestIds.some(id => !seen.has(id)));
    };
    $("closeFriendRequestsModal").addEventListener("click", closeAndRefreshRequestDot);
    requestsModal?.addEventListener("click", event => {
      if (event.target === requestsModal) closeAndRefreshRequestDot();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && requestsModal && !requestsModal.classList.contains("hidden")) {
        closeAndRefreshRequestDot();
      }
    });

    window.addEventListener("risk-game-initial-profile-created", async () => {
      if (!client || !configured || initialProfileCreationInProgress) return;
      const local = localProfile();
      const name = String(local.name || "").trim().slice(0, 20);
      if (!name || !/^\d{4}$/.test(String(local.code || ""))) {
        setMessage("신규 계정 정보가 올바르지 않습니다. 이름 등록을 다시 진행하세요.", true);
        return;
      }

      initialProfileCreationInProgress = true;
      try {
        // 신규 등록을 완료한 경우에만 익명 인증 계정을 만듭니다.
        // 이전 계정의 세션이 남아 있더라도 새 프로필을 그 계정에 덮어쓰지 않습니다.
        try { await client.auth.signOut({ scope: "local" }); } catch {}
        currentUser = null;
        syncedUserId = null;
        const { data: signed, error } = await withTimeout(client.auth.signInAnonymously({
          options: { data: { display_name: name } }
        }), "신규 온라인 계정 생성");
        if (error) throw error;
        currentUser = signed?.user || null;
        if (!currentUser) throw new Error("신규 계정 생성 응답에 사용자 정보가 없습니다.");
        updateAccountUi();
        await withTimeout(refreshCloudData(), "신규 계정 프로필 생성");
        setMessage("");
      } catch (error) {
        console.error("신규 온라인 계정 생성 실패:", error);
        setMessage("이름은 이 기기에 저장됐지만 온라인 계정 생성에 실패했습니다: " + String(error?.message || "다시 시도하세요."), true);
      } finally {
        initialProfileCreationInProgress = false;
      }
    });

    window.addEventListener("risk-game-profile-updated", event => {
      updateCloudName(event.detail);
    });
    window.addEventListener("risk-game-budget-updated", () => {
      // 예산 변경은 9초 제한을 우회해 서버에 즉시 반영합니다.
      syncMyPresence(true);
    });
    $("refreshFriendsButton").addEventListener("click", refreshFriendLists);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        // 화면에 돌아오면 접속 신호와 받은 친구 요청을 즉시 갱신합니다.
        syncMyPresence(true);
        loadRequests().catch(error => console.error("친구 요청 새로고침 실패:", error));
      }
    });

    updateAccountUi();
    loadRequests().catch(error => console.error("친구 요청 불러오기 실패:", error));
    window.setInterval(() => {
      if (currentUser) {
        // 친구 목록은 수동 갱신으로 유지하고, 받은 친구 요청과 접속 신호는 자동 갱신합니다.
        syncMyPresence().catch(() => {});
        if (document.visibilityState === "visible") {
          loadRequests().catch(error => console.error("친구 요청 자동 갱신 실패:", error));
        }
      }
    }, 5000);

    if (!configured) {
      $("friendMyCode").textContent = "연결 설정 확인 필요";
      setMessage("온라인 친구 기능의 Supabase 설정을 확인해야 합니다.", true);
      return;
    }
    if (!window.supabase?.createClient) {
      setMessage("Supabase 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.", true);
      return;
    }

    client.auth.onAuthStateChange((_event, session) => {
      const previousUserId = currentUser?.id || null;
      currentUser = session?.user || null;
      updateAccountUi();
      if (currentUser && currentUser.id !== previousUserId && !initialProfileCreationInProgress) {
        window.setTimeout(() => {
          refreshCloudData().catch(error => {
            console.error("계정 전환 후 프로필 새로고침 실패:", error);
          });
        }, 0);
      }
    });

    (async () => {
      const { data, error } = await withTimeout(client.auth.getSession(), "온라인 계정 확인");
      if (error) throw error;
      if (data.session?.user) {
        currentUser = data.session.user;
        updateAccountUi();
        await withTimeout(refreshCloudData(), "내 이름과 고유 코드 불러오기");
      } else {
        // 계정 선택 화면에 들어왔다는 이유만으로 익명 계정이나 프로필을 만들지 않습니다.
        // 신규 계정 등록 완료 이벤트에서만 명시적으로 계정을 생성합니다.
        currentUser = null;
        updateAccountUi();
        const code = $("friendMyCode");
        if (code) code.textContent = "계정 등록 후 표시됩니다.";
      }
    })().catch(error => {
      console.error("온라인 친구 기능 연결 실패:", error);
      const message = String(error?.message || "");
      connectionErrorMessage = message || "잠시 후 다시 시도하세요.";
      if (/anonymous|disabled/i.test(message)) {
        setMessage("Supabase 설정에서 익명 로그인을 한 번 켜야 합니다. 설정 후 새로고침하면 자동으로 연결됩니다.", true);
      } else if (/sync_risk_game_profile|function .* does not exist|schema cache/i.test(message)) {
        setMessage("친구 기능 업데이트를 위한 SQL 설정을 한 번 더 실행해야 합니다.", true);
      } else {
        setMessage("온라인 연결 실패: " + (message || "잠시 후 다시 시도하세요."), true);
      }
      updateAccountUi();
      const status = $("friendCloudStatus");
      if (status) status.textContent = "온라인 연결 실패 · " + connectionErrorMessage.slice(0, 180);
      const code = $("friendMyCode");
      if (code && (code.textContent === "불러오는 중..." || code.textContent === "연결 실패")) code.textContent = "연결 실패";
      loadFriends().catch(() => {});
      loadRequests().catch(() => {});
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
