import { h, render } from 'preact';
import htm from 'htm';
import { SyncOverlay } from './src/components/SyncOverlay.js'; // Import the new SyncOverlay component

const html = htm.bind(h);

// IndexedDB 관련 함수는 background.js로 이전되었으므로 여기서는 제거합니다.

// --- 데이터 파싱 로직 (테이블 기반으로 변경) ---

// 숫자 문자열에서 숫자만 추출하는 헬퍼 함수
function parseNumericValue(text) {
  if (!text) {
    console.warn("parseNumericValue: Input text is empty or null.");
    return 0;
  }
  const numericString = text.replace(/[^0-9]/g, '');
  const parsedInt = parseInt(numericString, 10);
  if (isNaN(parsedInt)) {
      console.warn(`parseNumericValue: Failed to parse integer from "${text}". Resulted in NaN.`);
      return 0;
  }
  console.log(`[Content Script] parseNumericValue: Parsed "${text}" to ${parsedInt}`); // 디버깅 로그 활성화
  return parsedInt;
}

// 테이블에서 작품명과 정산금액 추출
function parseNovelDataFromTable(doc = document) {
  const tableSelector = 'table.table-module_calculates-zfkCU';
  const table = doc.querySelector(tableSelector);
  if (!table) {
    console.warn(`Target table not found: ${tableSelector}`);
    return []; // 테이블 없으면 빈 배열 반환
  }

  const novelData = [];
  const rows = table.querySelectorAll('tbody tr.item'); // tbody 안의 tr.item 만 선택

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 7) { // 최소 7개의 셀이 있는지 확인
      const titleElement = cells[1]?.querySelector('a'); // 두 번째 셀(작품명)의 a 태그
      const amountText = cells[6]?.textContent; // 일곱 번째 셀(정산금액)의 텍스트

      if (titleElement && amountText) {
        const title = titleElement.textContent.trim();
        const amount = parseNumericValue(amountText);
        novelData.push({ '작품명': title, '정산금액': amount });
      } else {
        console.warn("Could not find title or amount in a row:", row);
      }
    } else {
      console.warn("Row does not have enough cells:", row);
    }
  });

  console.log(`Parsed ${novelData.length} novel data items from table.`);
  return novelData;
}


// 페이지 로딩 및 테이블 데이터 기다리는 함수 (MutationObserver 사용)
function waitForTableData(doc, searchDateYYYYMM, callback) {
  const settlementMonth = searchDateYYYYMM ? `${searchDateYYYYMM.substring(0, 4)}.${searchDateYYYYMM.substring(4, 6)}` : null;

  const tryParseTable = () => {
    const tableExists = doc.querySelector('table.table-module_calculates-zfkCU');
    if (tableExists) {
      const novelData = parseNovelDataFromTable(doc);
      console.log(`[Content Script] Table found for ${settlementMonth}. Parsed ${novelData.length} items.`);
      callback(novelData, settlementMonth);
      return true; // 테이블 찾음 (데이터 유무와 관계없이)
    }
    return false; // 테이블 아직 없음
  };

  // 즉시 파싱 시도
  if (tryParseTable()) {
    return; // 성공 시 종료
  }

  // 테이블이 초기에 없고, DOM 로드가 완료된 상태인지 확인
  if (doc.readyState !== 'loading' && !doc.querySelector('table.table-module_calculates-zfkCU')) {
      console.log(`[Content Script] Table not found initially for ${settlementMonth}. Sending empty data immediately.`);
      callback([], settlementMonth); // 테이블 없으면 즉시 빈 데이터 전송
      return;
  }

  // 테이블이 아직 로드되지 않았을 수 있으므로 MutationObserver 설정
  let observer = null;
  const TIMEOUT_DURATION = 30000; // 30초 타임아웃
  let timeoutId = null;

  const cleanup = () => {
    if (observer) observer.disconnect();
    if (timeoutId) clearTimeout(timeoutId);
    observer = null;
    timeoutId = null;
    // console.log("waitForTableData cleanup done.");
  };

  timeoutId = setTimeout(() => {
    console.warn(`Timeout waiting for table data for ${searchDateYYYYMM}.`);
    cleanup();
    const settlementMonth = searchDateYYYYMM ? `${searchDateYYYYMM.substring(0, 4)}.${searchDateYYYYMM.substring(4, 6)}` : null;
    // 타임아웃 시 빈 배열과 정산월 전달 (오류 대신)
    callback([], settlementMonth);
  }, TIMEOUT_DURATION);

  observer = new MutationObserver((mutations, obs) => {
    // console.log("MutationObserver triggered, trying to parse table..."); // 로그 줄이기
    if (tryParseTable()) { // tryParseTable 내부에서 callback 호출 및 true 반환
      cleanup();
    }
  });

  // 옵저버 시작 (DOM 로드 상태 고려)
  const startObserver = () => {
    if (doc.body) {
      observer.observe(doc.body, { childList: true, subtree: true });
      // console.log("MutationObserver started for table data.");
    } else {
      console.error("document.body not available to start observer.");
      cleanup();
      const settlementMonth = searchDateYYYYMM ? `${searchDateYYYYMM.substring(0, 4)}.${searchDateYYYYMM.substring(4, 6)}` : null;
      callback([], settlementMonth); // body 없으면 실패 처리 (빈 배열 전달)
    }
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }
}

const urlParams = new URL(window.location).searchParams;
const isFetchTab = urlParams.has("fetch"); // 'slave' 대신 'fetch' 파라미터 확인

if (isFetchTab) {
  // 데이터 수집용 탭 로직
  const searchDate = urlParams.get("searchDate"); // YYYYMM 형식
  if (searchDate && searchDate.length === 6) {
    console.log(`Fetch tab for ${searchDate} activated.`);
    waitForTableData(document, searchDate, function(novelData, settlementMonth) {
      console.log(`Parsed ${novelData.length} items for ${settlementMonth}.`);
      // 백그라운드로 파싱 결과 전송 (데이터 배열 포함)
      chrome.runtime.sendMessage({
        type: 'parsedMonthlyData',
        data: {
          settlementMonth: settlementMonth, // YYYY.MM 형식
          novelData: novelData // 작품 데이터 배열
        }
      }, response => {
         if (chrome.runtime.lastError) {
            console.error("Error sending parsed table data:", chrome.runtime.lastError.message);
         }
         // 메시지 전송 후 할 일 없음, 백그라운드가 탭 닫음
      });
    });
  } else {
    console.error("Fetch tab opened without valid searchDate parameter.");
    // 유효하지 않은 탭이면 바로 닫도록 메시지 전송 시도
    chrome.runtime.sendMessage({ type: 'closeTab' }).catch(e => console.warn("Failed to send closeTab message:", e));
  }

} else if (window.location.pathname.startsWith('/manage/calculate')) {
  // 메인 정산 페이지 로직 (오버레이 렌더링)
  console.log("Main calculate page detected. Rendering SyncOverlay.");

  // 기존 오버레이 컨테이너 제거 (있을 경우)
  const existingOverlay = document.getElementById('dataFetcherOverlayContainer');
  if (existingOverlay) existingOverlay.remove();
  const existingDbStatusOverlay = document.getElementById('dbStatusOverlayContainer');
  if (existingDbStatusOverlay) existingDbStatusOverlay.remove();

  // 새 오버레이 컨테이너 생성 및 렌더링
  const syncOverlayContainer = document.createElement('div');
  syncOverlayContainer.id = 'munpiaSyncOverlayContainer'; // 새 ID 사용
  document.body.appendChild(syncOverlayContainer);
  render(html`<${SyncOverlay} />`, syncOverlayContainer);

} else {
  // 그 외 Munpia 페이지 (아무 작업 안 함)
  // console.log("Not a target page for the extension.");
}
