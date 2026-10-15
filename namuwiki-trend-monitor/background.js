const ALARM_NAME = "checkKeywords";
const CHECK_INTERVAL_MINUTES = 15;
const ALLOWED_INTERVALS = [5, 15, 30, 60];
const CLEANUP_ALARM_NAME = "cleanupMonitorTab";

const NAMU_URL = "https://namu.wiki/w/나무위키:대문";
const TAB_KEY = "monitorTabId";

// 1. 주기적인 알람 설정
async function setupAlarm() {
    // 사용자가 저장한 수집 간격 가져오기
    const data = await chrome.storage.local.get(
        "checkIntervalMinutes"
    );

    // 저장된 값이 유효하면 사용하고, 없으면 기본값 15분 사용
    const interval = ALLOWED_INTERVALS.includes(
        data.checkIntervalMinutes
    )
        ? data.checkIntervalMinutes
        : CHECK_INTERVAL_MINUTES;

    // 기존 수집 알람 제거
    await chrome.alarms.clear(ALARM_NAME);

    // 새 주기로 알람 생성
    await chrome.alarms.create(ALARM_NAME, {
        delayInMinutes: interval,
        periodInMinutes: interval
    });

    console.log(
        `[Namu Monitor] ${interval}분 주기 알람 설정 완료`
    );
}

// 사용자가 수집 간격을 변경하면 알람을 다시 설정
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (
        areaName === "local" &&
        changes.checkIntervalMinutes
    ) {
        console.log(
            "[Namu Monitor] 수집 간격 변경 감지:",
            changes.checkIntervalMinutes.newValue
        );

        setupAlarm().catch(error => {
            console.error(
                "[Namu Monitor] 수집 간격 변경 실패:",
                error
            );
        });
    }
});

// 2. 자동 수집용 임시 탭 정리
async function closeMonitorTab(expectedTabId = null) {
    const data = await chrome.storage.session.get(TAB_KEY);
    const tabId = data.monitorTabId;

    if (tabId === undefined) {
        return;
    }

    // 다른 수집 작업의 탭은 건드리지 않음
    if (expectedTabId !== null && tabId !== expectedTabId) {
        return;
    }

    try {
        await chrome.tabs.remove(tabId);

        console.log("[Namu Monitor] 임시 탭 종료:", tabId);

    } catch (error) {
        // 탭이 이미 사라진 것인지 확인
        const remainingTab = await chrome.tabs.get(tabId)
            .catch(() => null);

        if (remainingTab) {
            console.error(
                "[Namu Monitor] 임시 탭 종료 실패:",
                tabId,
                error
            );
            return;
        }

        console.log("[Namu Monitor] 이미 종료된 탭:", tabId);
    }

    // 종료한 탭의 ID가 여전히 저장되어 있는지 확인
    const latest = await chrome.storage.session.get(TAB_KEY);

    if (latest.monitorTabId === tabId) {
        await chrome.storage.session.remove(TAB_KEY);

        // 정상 종료했으므로 30초 정리 알람은 불필요
        await chrome.alarms.clear(CLEANUP_ALARM_NAME);
    }
}


// Chrome 시작 또는 확장 프로그램 설치 시 초기화
async function initializeMonitor() {
    // 15분 주기 알람 등록
    await setupAlarm();

    // 기다리지 않고 검색어 즉시 수집
    await startKeywordCollection();
}

// 3. 확장 프로그램 설치 및 업데이트
chrome.runtime.onInstalled.addListener(() => {
    initializeMonitor().catch(console.error);
});

// 4. Chrome 시작 시
chrome.runtime.onStartup.addListener(() => {
    initializeMonitor().catch(console.error);
});

// 5. 검색어 수집 함수
let collectionStarting = false;

async function startKeywordCollection() {
    // 동시에 수집 시작 함수가 실행되는 상황 방지
    if (collectionStarting) {
        console.log("[Namu Monitor] 이미 수집 시작 중입니다.");
        return;
    }

    collectionStarting = true;

    try {
        // 기존 임시 탭 확인
        const session = await chrome.storage.session.get(TAB_KEY);

        if (session.monitorTabId !== undefined) {
            const existingTab = await chrome.tabs
                .get(session.monitorTabId)
                .catch(() => null);

            // 실제로 탭이 존재하면 중복 수집하지 않음
            if (existingTab) {
                console.log(
                    "[Namu Monitor] 수집 진행 중, 중복 실행 방지"
                );
                return;
            }

            // 이미 닫힌 탭의 오래된 기록 정리
            await closeMonitorTab(session.monitorTabId);
        }

        console.log("[Namu Monitor] 자동 수집 시작!");

        // 검색어 수집용 탭 생성
        const tab = await chrome.tabs.create({
            url: NAMU_URL,
            active: false
        });

        try {
            // 생성한 탭 ID 저장
            await chrome.storage.session.set({
                [TAB_KEY]: tab.id
            });

            // 30초 후 자동 정리 예약
            await chrome.alarms.create(
                CLEANUP_ALARM_NAME,
                {
                    delayInMinutes: 0.5
                }
            );

            console.log(
                "[Namu Monitor] 임시 탭 생성:",
                tab.id
            );

        } catch (error) {
            console.error(
                "[Namu Monitor] 탭 설정 실패:",
                error
            );

            const current = await chrome.storage.session
                .get(TAB_KEY)
                .catch(() => ({}));

            if (current.monitorTabId === tab.id) {
                await closeMonitorTab(tab.id);
            } else {
                await chrome.tabs.remove(tab.id)
                    .catch(closeError => {
                        console.error(
                            "[Namu Monitor] 임시 탭 직접 종료 실패:",
                            closeError
                        );
                    });
            }
        }

    } catch (error) {
        console.error(
            "[Namu Monitor] 수집 시작 실패:",
            error
        );

    } finally {
        collectionStarting = false;
    }
}


// 6. 알람 이벤트 처리
chrome.alarms.onAlarm.addListener((alarm) => {

    // 30초 정리 알람
    if (alarm.name === CLEANUP_ALARM_NAME) {
        (async () => {
            const data = await chrome.storage.session.get(TAB_KEY);

            if (data.monitorTabId === undefined) {
                return;
            }

            console.warn(
                "[Namu Monitor] 수집 시간 초과! 임시 탭 정리"
            );

            await closeMonitorTab(data.monitorTabId);

        })().catch(console.error);

        return;
    }

    // 15분 주기 검색어 수집 알람
    if (alarm.name === ALARM_NAME) {
        startKeywordCollection().catch(console.error);
    }
});



function getLocalDateKey() {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}


async function showNewKeywordNotification(newEntries) {
    // 새 검색어가 없으면 알림을 보내지 않음
    if (newEntries.length === 0) {
        return;
    }

    // 알림에 표시할 검색어 (최대 3개)
    const messages = newEntries
        .slice(0, 3)
        .map(entry => `${entry.rank}위: ${entry.keyword}`);

    // 3개 초과 시 나머지 개수 표시
    const remaining = newEntries.length - messages.length;

    if (remaining > 0) {
        messages.push(`외 ${remaining}개`);
    }

    const title = newEntries.length === 1
        ? "새로운 실시간 검색어 발견!"
        : `새로운 실시간 검색어 ${newEntries.length}개 발견!`;

    const notificationId = await chrome.notifications.create(
        `namu-trend-${Date.now()}`,
        {
            type: "basic",
            iconUrl: chrome.runtime.getURL("icons/icon128.png"),
            title: title,
            message: messages.join("\n"),
            requireInteraction: false
        }
    );

    console.log(
        "[Namu Monitor] Windows 알림 전송 완료:",
        notificationId
    );
}


// 6. 검색어 수신 및 당일 중복 검사
chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.type !== "NAMU_KEYWORDS_COLLECTED") {
        return;
    }

    (async () => {
        const session = await chrome.storage.session.get(TAB_KEY);

        if (
            session.monitorTabId === undefined ||
            sender.tab?.id !== session.monitorTabId
        ) {
            return;
        }

        try {
            const currentKeywords = message.keywords;

            if (
                !Array.isArray(currentKeywords) ||
                currentKeywords.length !== 10 ||
                currentKeywords.some(
                    keyword =>
                        typeof keyword !== "string" ||
                        !keyword.trim()
                ) ||
                new Set(currentKeywords).size !== 10
            ) {
                console.warn("[Namu Monitor] 검색어 데이터 오류");
                return;
            }

            const saved = await chrome.storage.local.get([
                "seenDate",
                "seenKeywords",
                "previousKeywords",
                "pendingDate",
                "pendingNewEntries"
            ]);

            const today = getLocalDateKey();

            const firstRun =
                !saved.seenDate ||
                !Array.isArray(saved.seenKeywords);

            const newDay = !firstRun && saved.seenDate !== today;

            // 최초 실행 또는 날짜 변경 시 기준 목록 설정
            let seenKeywords;

            if (firstRun) {
                seenKeywords = [...currentKeywords];
                console.log("[Namu Monitor] 최초 기준 목록 생성");
            } else if (newDay) {
                seenKeywords = Array.isArray(saved.previousKeywords)
                    ? [...saved.previousKeywords]
                    : [...currentKeywords];

                console.log("[Namu Monitor] 날짜 변경, 기록 초기화");
            } else {
                seenKeywords = [...saved.seenKeywords];
            }

            const seenSet = new Set(seenKeywords);

            // 오늘 처음 발견된 검색어 및 현재 순위
            const newEntries = currentKeywords
                .map((keyword, index) => ({
                    keyword,
                    rank: index + 1
                }))
                .filter(entry => !seenSet.has(entry.keyword));

            // 오늘 등장한 모든 검색어 누적
            const updatedSeenKeywords = [
                ...new Set([
                    ...seenKeywords,
                    ...currentKeywords
                ])
            ];

            // 오늘 전송하지 못한 알림 불러오기
            const previousPending =
                saved.pendingDate === today &&
                Array.isArray(saved.pendingNewEntries)
                    ? saved.pendingNewEntries
                    : [];

            // 이전 실패 알림 + 이번 신규 검색어 합치기
            const notificationsToSend = [
                ...new Map(
                    [...previousPending, ...newEntries].map(
                        entry => [entry.keyword, entry]
                    )
                ).values()
            ];
            
            // 수집 결과와 알림 대기 목록을 먼저 저장
            await chrome.storage.local.set({
                seenDate: today,
                seenKeywords: updatedSeenKeywords,
                previousKeywords: currentKeywords,
                currentKeywords: currentKeywords,
                latestNewEntries: newEntries,
                lastCheckedAt: Date.now(),

                pendingDate: today,
                pendingNewEntries: notificationsToSend
            });

            if (newEntries.length > 0) {
                console.log(
                    "[Namu Monitor] 오늘 처음 등장한 검색어:",
                    newEntries
                );
            } else {
                console.log("[Namu Monitor] 신규 검색어 없음");
            }

            // 새 알림 또는 이전에 실패한 알림이 있으면 전송
            if (notificationsToSend.length > 0) {
                try {
                    await showNewKeywordNotification(
                        notificationsToSend
                    );

                    // 알림 생성에 성공하면 대기 목록 비우기
                    await chrome.storage.local.set({
                        pendingDate: today,
                        pendingNewEntries: []
                    });

                    console.log(
                        "[Namu Monitor] 알림 처리 완료"
                    );

                } catch (error) {
                    // 대기 목록은 삭제하지 않음
                    console.error(
                        "[Namu Monitor] 알림 처리 실패, 다음 수집에서 재시도:",
                        error
                    );
                }
            }

            console.log(
                "[Namu Monitor] 오늘 누적 검색어:",
                updatedSeenKeywords.length
            );


        } finally {
            await closeMonitorTab(sender.tab?.id);
        }
    })().catch(error => {
        console.error("[Namu Monitor] 처리 실패:", error);
    });
});
