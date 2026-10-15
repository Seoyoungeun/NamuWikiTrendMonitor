console.log("[Namu Monitor] content.js 실행 확인!");

// 1. 실시간 검색어 TOP 10 추출
function getRealtimeKeywords() {
    const lists = [...document.querySelectorAll("ul")];

    // 실시간 검색어 목록 찾기
    const realtimeList = lists.find(ul => {
        const links = [...ul.querySelectorAll("li a")];

        return (
            links.length >= 10 &&
            links.every(a =>
                a.getAttribute("href")?.startsWith("/Go?q=") &&
                a.hasAttribute("title")
            )
        );
    });

    if (!realtimeList) {
        return null;
    }

    // 검색어 추출
    const keywords = [...realtimeList.querySelectorAll("li a")]
        .map(a => a.getAttribute("title")?.trim())
        .filter(Boolean);

    // 중복 제거 후 TOP 10
    const top10 = [...new Set(keywords)].slice(0, 10);

    return top10.length === 10 ? top10 : null;
}

// 2. 검색어 수집 및 전송
function collectKeywords() {
    let attempts = 0;

    const timer = setInterval(() => {
        attempts++;

        const keywords = getRealtimeKeywords();

        // 검색어 수집 성공
        if (keywords) {
            clearInterval(timer);

            console.log("[Namu Monitor] 검색어 수집 성공!");

            console.table(
                keywords.map((keyword, index) => ({
                    rank: index + 1,
                    keyword
                }))
            );

            // 확장 프로그램이 새로고침되어
            // 기존 스크립트의 실행 환경이 무효화된 경우
            if (!chrome.runtime?.id) {
                console.warn(
                    "[Namu Monitor] 확장 프로그램 연결이 유효하지 않습니다."
                );
                return;
            }

            // background.js로 검색어 전송
            chrome.runtime.sendMessage({
                type: "NAMU_KEYWORDS_COLLECTED",
                keywords: keywords,
                collectedAt: Date.now()
            }).catch(error => {
                console.error(
                    "[Namu Monitor] 메시지 전송 실패:",
                    error
                );
            });

            return;
        }

        // 최대 15회 시도 후 실패
        if (attempts >= 15) {
            clearInterval(timer);

            console.warn(
                "[Namu Monitor] 검색어 수집 실패 (15초 초과)"
            );
        }

    }, 1000);
}

// 3. 나무위키 대문에서만 검색어 수집 실행
if (
    decodeURIComponent(window.location.pathname) ===
    "/w/나무위키:대문"
) {
    collectKeywords();
}