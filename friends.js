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
    latestRequestIds = requests.map(request => String(request.notificationKey || ("request:" + request.id)));
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
    ["addFriendButton", "refreshFriendsButton", "giftConfirmButton"]
      .forEach(id => {
        const button = $(id);
        if (button) button.disabled = value;
      });
    document.querySelectorAll("#friendRequests button").forEach(button => { if (!button.classList.contains("is-claimed")) button.disabled = value; });
    document.querySelectorAll(".friend-row-actions button").forEach(button => { button.disabled = value; });
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

    const actions = document.createElement("div");
    actions.className = "friend-row-actions";
    const gift = document.createElement("button");
    gift.type = "button"; gift.className = "friend-gift-button"; gift.textContent = "선물하기";
    gift.setAttribute("aria-label", friend.display_name + " 님에게 선물하기");
    gift.addEventListener("click", () => openGiftModal(friend));
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "friend-remove-button"; remove.textContent = "삭제";
    remove.setAttribute("aria-label", friend.display_name + " 친구 삭제");
    remove.addEventListener("click", () => removeFriend(friend.id, friend.display_name));
    actions.append(gift, remove); row.append(details, actions); return row;
  }

  function makeRequestRow(request) {
    if (request.kind === "gift") return makeGiftNotificationRow(request);
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

  function makeGiftNotificationRow(gift) {
    const row=document.createElement("div");row.className="friend-row friend-gift-notification-row";
    const details=document.createElement("div");details.className="friend-row-details";
    const title=document.createElement("strong");title.textContent=gift.sender_name+"#"+(gift.sender_code||"----")+" 님이 선물을 보냈습니다.";
    const amount=document.createElement("span");amount.className="friend-gift-amount";amount.textContent=formatFriendMoney(gift.amount);
    const note=document.createElement("span");note.textContent=gift.status==="accepted"?"받은 선물":"받기 버튼을 누르면 보유 예산에 추가됩니다.";
    details.append(title,amount,note);
    const claim=document.createElement("button");claim.type="button";claim.className="friend-gift-claim-button"+(gift.status==="accepted"?" is-claimed":"");
    claim.textContent=gift.status==="accepted"?"✓":"받기";claim.disabled=busy||gift.status==="accepted";
    claim.setAttribute("aria-label",gift.status==="accepted"?"이미 받은 선물":gift.sender_name+" 님의 선물 받기");
    if(gift.status!=="accepted")claim.addEventListener("click",()=>acceptGift(gift));
    row.append(details,claim);return row;
  }
  async function loadRequests() {
    const list=$("friendRequests");if(!list)return;
    if(!client||!currentUser){latestRequestIds=[];const sig="offline";if(renderedRequestsSignature!==sig){const e=document.createElement("p");e.className="muted friend-empty";e.textContent="온라인 연결 후 알림을 확인할 수 있습니다.";list.replaceChildren(e);renderedRequestsSignature=sig;}return;}
    // 친구 요청과 선물은 서로 독립적으로 불러옵니다. 친구 요청 조회 오류 때문에
    // 선물 알림까지 통째로 사라지는 일을 막고, 선물 조회 오류는 화면에 알립니다.
    let requests=[];
    let requestLoadError=null;
    const requestResult=await client.from("friend_requests")
      .select("id,sender_id,sender_name,sender_code,created_at")
      .eq("receiver_id",currentUser.id).eq("status","pending")
      .order("created_at",{ascending:true});
    if(requestResult.error){
      requestLoadError=requestResult.error;
      console.error("친구 요청 불러오기 실패:",requestResult.error);
    }else{
      requests=requestResult.data||[];
    }

    let gifts=[];
    let giftLoadError=null;
    let giftResult=await client.from("friend_gifts")
      .select("id,sender_id,receiver_id,sender_name,sender_code,amount,status,created_at")
      .eq("receiver_id",currentUser.id).order("created_at",{ascending:false}).limit(50);
    if(giftResult.error && /sender_code|column/i.test(String(giftResult.error.message||""))){
      // sender_code 열이 아직 없는 구버전 DB에서도 선물 자체는 표시합니다.
      giftResult=await client.from("friend_gifts")
        .select("id,sender_id,receiver_id,sender_name,amount,status,created_at")
        .eq("receiver_id",currentUser.id).order("created_at",{ascending:false}).limit(50);
    }
    if(giftResult.error){
      giftLoadError=giftResult.error;
      console.error("선물 알림 불러오기 실패:",giftResult.error);
    }else{
      gifts=(giftResult.data||[]).map(gift=>({...gift,sender_code:gift.sender_code||""}));
      // sender_code 열이 없거나 예전 선물 행에 코드가 비어 있어도,
      // 보낸 사람의 프로필에서 영구 친구 코드를 가져와 표시합니다.
      const missingCodeIds=[...new Set(gifts.filter(gift=>!/^\d{4}$/.test(String(gift.sender_code||""))).map(gift=>gift.sender_id).filter(Boolean))];
      if(missingCodeIds.length){
        const codeResult=await client.from("profiles").select("id,friend_code").in("id",missingCodeIds);
        if(codeResult.error){
          console.warn("선물 보낸 사람 코드 조회 실패:",codeResult.error);
        }else{
          const codeById=new Map((codeResult.data||[]).map(profile=>[profile.id,String(profile.friend_code||"")]));
          gifts=gifts.map(gift=>({
            ...gift,
            sender_code:/^\d{4}$/.test(String(gift.sender_code||""))?String(gift.sender_code):(/^[0-9]{4}$/.test(codeById.get(gift.sender_id)||"")?codeById.get(gift.sender_id):"")
          }));
        }
      }
    }
    if(giftLoadError){
      setMessage("선물 알림을 불러오지 못했습니다. 선물은 다시 보내지 말고 친구 기능 연결 상태를 확인하세요. ("+String(giftLoadError.message||"조회 오류").slice(0,140)+")",true);
    }else if(requestLoadError){
      setMessage("친구 요청을 불러오지 못했지만 선물 알림은 별도로 확인하고 있습니다. ("+String(requestLoadError.message||"조회 오류").slice(0,100)+")",true);
    }
    const rr=(requests||[]).map(x=>({...x,kind:"request",notificationKey:"request:"+x.id}));
    const gg=gifts.map(x=>({...x,kind:"gift",notificationKey:"gift:"+x.id}));
    const rows=[...rr,...gg].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
    const pending=[...rr.map(x=>x.notificationKey),...gg.filter(x=>x.status==="pending").map(x=>x.notificationKey)];
    refreshFriendRequestDot(pending.map(id=>({id})));
    const sig=currentUser.id+":"+JSON.stringify(rows.map(x=>[x.kind,x.id,x.sender_id,x.sender_name,x.sender_code||"",x.amount||0,x.status||"",x.created_at]));
    if(sig===renderedRequestsSignature)return;
    const frag=document.createDocumentFragment();
    if(!rows.length){const e=document.createElement("p");e.className="muted friend-empty";e.textContent="새로운 알림이 없습니다.";frag.append(e);}else rows.forEach(x=>frag.append(makeRequestRow(x)));
    list.replaceChildren(frag);renderedRequestsSignature=sig;
  }

  let presenceSyncPromise = null;

  async function syncMyPresence(force = false) {
    if (!client || !currentUser || document.visibilityState !== "visible") return false;
    const now = Date.now();

    // 선물 전송 직전에는 최신 예산이 서버에 반영될 때까지 기다립니다.
    // 이전 버전은 이미 진행 중인 동기화가 있으면 즉시 반환해,
    // 선물 RPC가 오래된 서버 예산을 읽는 경쟁 상태가 발생할 수 있었습니다.
    if (presenceSyncPromise) {
      if (!force && now - lastPresenceSyncAt < 9000) {
        return await presenceSyncPromise;
      }
      await presenceSyncPromise;
      return force ? syncMyPresence(true) : false;
    }
    if (!force && now - lastPresenceSyncAt < 9000) return true;

    lastPresenceSyncAt = now;
    const run = (async () => {
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
        return true;
      } catch (error) {
        console.error("온라인 상태/예산 동기화 실패:", error);
        return false;
      }
    })();

    presenceSyncPromise = run;
    presenceSyncInProgress = true;
    try {
      return await run;
    } finally {
      presenceSyncInProgress = false;
      if (presenceSyncPromise === run) presenceSyncPromise = null;
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

  let selectedGiftFriend=null;
  function openGiftModal(friend){selectedGiftFriend=friend;$("giftModalTitle").textContent=friend.display_name+" 님에게 선물";$("giftModalDescription").textContent="현재 보유 예산 "+formatFriendMoney(typeof window.riskGameGetBudget==="function"?window.riskGameGetBudget():0);$("giftAmountInput").value="";$("giftModalError").textContent="";$("friendGiftModal").classList.remove("hidden");window.setTimeout(()=>$("giftAmountInput")?.focus(),0);}
  function closeGiftModal(){$("friendGiftModal")?.classList.add("hidden");selectedGiftFriend=null;$("giftModalError").textContent="";}
  async function sendGift(){
    if(!selectedGiftFriend||busy||!client||!currentUser)return;
    const raw=$("giftAmountInput").value.trim(),amount=Number(raw),budget=Number(typeof window.riskGameGetBudget==="function"?window.riskGameGetBudget():0);
    if(!raw||!Number.isSafeInteger(amount)||amount<=0){$("giftModalError").textContent="1원 이상의 안전한 정수 금액을 입력하세요.";return;}
    if(amount>budget){$("giftModalError").textContent="보유 예산보다 많이 선물할 수 없습니다.";return;}
    setBusy(true);$("giftConfirmButton").disabled=true;$("giftModalError").textContent="";
    try{if(!(await syncMyPresence(true)))throw new Error("예산 동기화에 실패했습니다. 인터넷 연결을 확인하고 다시 시도하세요.");const {error}=await client.rpc("send_risk_game_gift",{p_receiver_id:selectedGiftFriend.id,p_amount:amount});if(error)throw error;
      if(typeof window.riskGameChangeBudget!=="function"||!window.riskGameChangeBudget(-amount))throw new Error("선물은 전송됐지만 이 기기의 예산을 갱신하지 못했습니다. 새로고침해 확인하세요.");
      closeGiftModal();await loadFriends();
    }catch(error){console.error("선물 전송 실패:",error);$("giftModalError").textContent=String(error?.message||"선물 전송에 실패했습니다.");}
    finally{setBusy(false);if($("giftConfirmButton"))$("giftConfirmButton").disabled=false;}
  }
  async function acceptGift(gift){
    if(!client||!currentUser||busy||gift.status!=="pending")return;setBusy(true);
    try{const {data,error}=await client.rpc("accept_risk_game_gift",{p_gift_id:gift.id});if(error)throw error;const result=Array.isArray(data)?data[0]:data,amount=Number(result?.amount??gift.amount);
      if(!Number.isSafeInteger(amount)||amount<=0)throw new Error("선물 금액을 확인할 수 없습니다.");
      if(typeof window.riskGameChangeBudget!=="function"||!window.riskGameChangeBudget(amount))throw new Error("선물은 처리됐지만 이 기기의 예산을 갱신하지 못했습니다. 새로고침해 확인하세요.");
      await loadRequests();
    }catch(error){console.error("선물 받기 실패:",error);setMessage("선물을 받지 못했습니다: "+String(error?.message||"다시 시도하세요."),true);}
    finally{setBusy(false);}
  }

  async function refreshFriendLists() {
    const button = $("refreshFriendsButton");
    if (busy) return;
    setBusy(true);
    setMessage("");
    if (button) {
      button.textContent = "↻";
      button.setAttribute("aria-label", "친구 목록 새로고침 중");
      button.title = "새로고침 중...";
    }
    try {
      if (!client || !currentUser) {
        const connected = await reconnectOnline();
        if (!connected || !currentUser) {
          throw new Error("온라인 연결에 실패했습니다. 잠시 후 다시 시도하세요.");
        }
      }
      await syncMyPresence(true);
      await Promise.all([loadFriends(), loadRequests()]);
      setMessage("");
    } catch (error) {
      console.error("친구 목록 수동 새로고침 실패:", error);
      setMessage("새로고침에 실패했습니다: " + String(error?.message || "알 수 없는 오류"), true);
    } finally {
      if (button) {
        button.textContent = "↻";
        button.setAttribute("aria-label", "친구 목록 새로고침");
        button.title = "새로고침";
      }
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

    const giftModal=$("friendGiftModal");
    $("closeFriendGiftModal").addEventListener("click",closeGiftModal);
    giftModal?.addEventListener("click",event=>{if(event.target===giftModal)closeGiftModal();});
    $("giftConfirmButton").addEventListener("click",sendGift);
    $("giftAmountInput").addEventListener("keydown",event=>{if(event.key==="Enter")sendGift();});
    const friendAddModal = $("friendAddModal");
    const closeFriendAddModal = () => friendAddModal?.classList.add("hidden");
    $("openFriendAddModalButton").addEventListener("click", () => {
      friendAddModal?.classList.remove("hidden");
      window.setTimeout(() => $("friendNameInput")?.focus(), 0);
    });
    $("closeFriendAddModal").addEventListener("click", closeFriendAddModal);
    friendAddModal?.addEventListener("click", event => {
      if (event.target === friendAddModal) closeFriendAddModal();
    });
    document.addEventListener("keydown", event => {
      if(event.key==="Escape"&&giftModal&&!giftModal.classList.contains("hidden"))closeGiftModal();
      if(event.key==="Escape"&&friendAddModal&&!friendAddModal.classList.contains("hidden"))closeFriendAddModal();
    });

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
