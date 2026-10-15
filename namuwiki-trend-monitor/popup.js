
// 오늘 날짜를 YYYY-MM-DD 형식으로 반환
function getTodayKey() {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

// 검색어를 클릭할 수 있는 링크 생성
function createKeywordLink(keyword) {
    const link = document.createElement("a");

    link.className = "keyword";
    link.textContent = keyword;
    link.href =
        "https://namu.wiki/Go?q=" +
        encodeURIComponent(keyword);

    link.target = "_blank";
    link.rel = "noopener noreferrer";

    return link;
}

// TOP 10 검색어 표시
function renderRanking(keywords, newEntries) {
    const list = document.getElementById("rankingList");

    list.replaceChildren();

    if (!Array.isArray(keywords) || keywords.length === 0) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = "저장된 검색어가 없습니다.";
        list.appendChild(li);
        return;
    }

    const newSet = new Set(
        newEntries.map(entry => entry.keyword)
    );

    keywords.forEach((keyword, index) => {
        const li = document.createElement("li");
        li.className = "ranking-item";

        // 순위
        const rank = document.createElement("span");
        rank.className = "rank";
        rank.textContent = index + 1;

        // 검색어 링크
        const link = createKeywordLink(keyword);

        li.appendChild(rank);
        li.appendChild(link);

        
        // 최근 신규 진입 검색어 표시
        if (newSet.has(keyword)) {
            const badge = document.createElement("span");
            badge.className = "new-badge";
            badge.textContent = "NEW";
            li.appendChild(badge);
        }

        // 아카라이브 검색 링크 생성
        const reasonLink = document.createElement("a");

        reasonLink.className = "reason-link";
        reasonLink.textContent = "이유";

        // 해당 검색어의 아카라이브 검색 결과로 이동
        reasonLink.href =
            "https://arca.live/b/namuhotnow?target=all&keyword=" +
            encodeURIComponent(keyword);

        reasonLink.target = "_blank";
        reasonLink.rel = "noopener noreferrer";

        li.appendChild(reasonLink);

        list.appendChild(li);
    });
}

// 저장된 데이터 불러오기
async function loadData() {
    try {
        const data = await chrome.storage.local.get([
            "seenDate",
            "currentKeywords",
            "latestNewEntries",
            "lastCheckedAt"
        ]);

        const currentKeywords = Array.isArray(data.currentKeywords)
            ? data.currentKeywords
            : [];


        const newEntries = Array.isArray(data.latestNewEntries)
            ? data.latestNewEntries
            : [];

        // 저장된 기록이 오늘 날짜인지 확인
        const isToday = data.seenDate === getTodayKey();


        // 전날 신규 검색어는 NEW 표시하지 않음
        const visibleNewEntries = isToday
            ? newEntries
            : [];

        document.getElementById("seenDate")
            .textContent =
                `기록 기준일: ${data.seenDate || "-"}`;

        // 마지막 수집 시간
        const lastChecked = data.lastCheckedAt
            ? new Date(data.lastCheckedAt).toLocaleString("ko-KR")
            : "수집 기록 없음";

        document.getElementById("lastChecked")
            .textContent = `마지막 수집: ${lastChecked}`;

        // 목록 표시
        renderRanking(currentKeywords, visibleNewEntries);

        document.getElementById("status")
            .textContent = currentKeywords.length > 0
                ? ""
                : "첫 검색어 수집을 기다리는 중";

    } catch (error) {
        console.error("[Namu Monitor] 팝업 오류:", error);

        document.getElementById("status")
            .textContent = "데이터를 불러오지 못했습니다.";
    }
}

// 팝업이 열리면 데이터 불러오기
loadData();

// 팝업이 열린 상태에서 저장소가 바뀌면 다시 표시
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
        loadData();
    }
});


// 사용자가 선택할 수 있는 수집 간격
const ALLOWED_INTERVALS = [5, 15, 30, 60];

const intervalSelect = document.getElementById("intervalSelect");
const saveIntervalButton =
    document.getElementById("saveIntervalButton");
const intervalStatus = document.getElementById("intervalStatus");

// 1. 저장된 수집 간격 불러오기
async function loadIntervalSetting() {
    try {
        const data = await chrome.storage.local.get(
            "checkIntervalMinutes"
        );

        const savedInterval = data.checkIntervalMinutes;

        // 저장된 설정이 없으면 기본 15분
        const interval = ALLOWED_INTERVALS.includes(savedInterval)
            ? savedInterval
            : 15;

        intervalSelect.value = String(interval);

    } catch (error) {
        console.error(
            "[Namu Monitor] 설정 불러오기 실패:",
            error
        );

        intervalStatus.textContent =
            "수집 간격을 불러오지 못했습니다.";
    }
}

// 2. 저장 버튼 클릭 시
saveIntervalButton.addEventListener("click", async () => {
    const interval = Number(intervalSelect.value);

    if (!ALLOWED_INTERVALS.includes(interval)) {
        intervalStatus.textContent = "잘못된 수집 간격입니다.";
        return;
    }

    saveIntervalButton.disabled = true;

    try {
        // 사용자가 선택한 값 저장
        await chrome.storage.local.set({
            checkIntervalMinutes: interval
        });

        intervalStatus.textContent =
            `${interval}분 간격으로 저장했습니다.`;

        console.log(
            "[Namu Monitor] 수집 간격 저장:",
            interval
        );

    } catch (error) {
        console.error(
            "[Namu Monitor] 설정 저장 실패:",
            error
        );

        intervalStatus.textContent =
            "설정을 저장하지 못했습니다.";

    } finally {
        saveIntervalButton.disabled = false;
    }
});

// 3. 팝업을 열면 저장된 설정 표시
loadIntervalSetting();


// Windows 알림 ON/OFF 설정
const notificationToggle =
    document.getElementById("notificationsEnabled");

const notificationStatus =
    document.getElementById("notificationStatus");

// 저장된 알림 설정 불러오기
async function loadNotificationSetting() {
    try {
        const data = await chrome.storage.local.get(
            "notificationsEnabled"
        );

        // 설정이 없다면 기본값 ON
        notificationToggle.checked =
            data.notificationsEnabled !== false;

    } catch (error) {
        console.error(
            "[Namu Monitor] 알림 설정 불러오기 실패:",
            error
        );
    }
}

// 체크박스 변경 시 바로 저장
notificationToggle.addEventListener("change", async () => {
    const enabled = notificationToggle.checked;
    notificationToggle.disabled = true;

    try {
        if (enabled) {
            await chrome.storage.local.set({
                notificationsEnabled: true
            });
        } else {
            // 알림을 끌 때 미전송 알림도 폐기
            await chrome.storage.local.set({
                notificationsEnabled: false,
                pendingNewEntries: []
            });
        }

        notificationStatus.textContent = enabled
            ? "Windows 알림을 켰습니다."
            : "Windows 알림을 껐습니다.";

    } catch (error) {
        notificationToggle.checked = !enabled;

        notificationStatus.textContent =
            "알림 설정 저장에 실패했습니다.";

        console.error(error);

    } finally {
        notificationToggle.disabled = false;
    }
});

loadNotificationSetting();
