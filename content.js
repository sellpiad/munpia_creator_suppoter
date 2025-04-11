import { h, render, Fragment } from 'preact'; // Fragment 추가
import htm from 'htm';
import { SyncOverlay } from './src/components/SyncOverlay.js';
import { UploadOverlay } from './src/components/UploadOverlay.js'; // 새로 만든 UploadOverlay 임포트

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
  console.log(`[Content Script] Attempting to find table with selector: ${tableSelector}`);
  const table = doc.querySelector(tableSelector);
  if (!table) {
    console.warn(`[Content Script] Target table not found: ${tableSelector}`);
    return []; // 테이블 없으면 빈 배열 반환
  }
  console.log("[Content Script] Table found.");

  const novelData = [];
  const rows = table.querySelectorAll('tbody tr.item'); // tbody 안의 tr.item 만 선택
  console.log(`[Content Script] Found ${rows.length} rows in table body.`);

  rows.forEach((row, index) => {
    console.log(`[Content Script] Processing row ${index + 1}`);
    const cells = row.querySelectorAll('td');
    console.log(`[Content Script] Row ${index + 1} has ${cells.length} cells.`);

    if (cells.length >= 7) { // 최소 7개의 셀이 있는지 확인
      const titleElement = cells[1]?.querySelector('a'); // 두 번째 셀(작품명)의 a 태그
      const amountText = cells[6]?.textContent; // 일곱 번째 셀(정산금액)의 텍스트

      const titleText = titleElement ? titleElement.textContent.trim() : 'N/A';
      const rawAmountText = amountText || 'N/A';
      console.log(`[Content Script] Row ${index + 1}: Raw Title='${titleText}', Raw Amount='${rawAmountText}'`);

      if (titleElement && amountText) {
        const title = titleText;
        const amount = parseNumericValue(amountText); // parseNumericValue 내부 로그도 확인 필요
        console.log(`[Content Script] Row ${index + 1}: Parsed Title='${title}', Parsed Amount=${amount}`);
        novelData.push({ '작품명': title, '정산금액': amount });
      } else {
        console.warn(`[Content Script] Could not find title element or amount text in row ${index + 1}:`, row);
      }
    } else {
      console.warn(`[Content Script] Row ${index + 1} does not have enough cells (needs >= 7):`, row);
    }
  });

  console.log(`[Content Script] Finished parsing. Parsed ${novelData.length} novel data items from table.`);
  return novelData;
}


// 페이지 로딩 및 테이블 또는 "작품 없음" 표시 기다리는 함수 (MutationObserver 사용)
function waitForTableData(doc, searchDateYYYYMM, callback) {
  const settlementMonth = searchDateYYYYMM ? `${searchDateYYYYMM.substring(0, 4)}.${searchDateYYYYMM.substring(4, 6)}` : null;
  const tableSelector = 'table.table-module_calculates-zfkCU';
  const noDataSelector = 'div.EmptyPage-module_empty-wrap-WzZki'; // "작품 없음" 표시 선택자

  let observer = null;
  const TIMEOUT_DURATION = 30000; // 30초 타임아웃
  let timeoutId = null;

  const cleanup = () => {
    if (observer) observer.disconnect();
    if (timeoutId) clearTimeout(timeoutId);
    observer = null;
    timeoutId = null;
    console.log("[Content Script] Cleanup done.");
  };

  // 테이블 또는 "작품 없음" 표시를 확인하고 콜백 호출하는 함수
  const checkContentAndCallback = () => {
    const tableElement = doc.querySelector(tableSelector);
    const noDataElement = doc.querySelector(noDataSelector);

    if (tableElement) {
      console.log(`[Content Script] Table found for ${settlementMonth}. Parsing data...`);
      const novelData = parseNovelDataFromTable(doc); // parseNovelDataFromTable은 테이블 존재 가정
      callback(novelData, settlementMonth);
      cleanup();
      return true; // 처리 완료
    } else if (noDataElement) {
      console.log(`[Content Script] "No data" indicator found for ${settlementMonth}. Sending empty array.`);
      callback([], settlementMonth); // 작품 없음 표시 발견 시 빈 배열 전송
      cleanup();
      return true; // 처리 완료
    }
    // console.log("[Content Script] Neither table nor 'no data' indicator found yet.");
    return false; // 아직 대상 없음
  };

  // 즉시 확인 시도
  if (checkContentAndCallback()) {
    return; // 성공 시 종료
  }

  // --- 즉시 빈 데이터 보내는 로직 제거 ---
  // if (doc.readyState !== 'loading' && !doc.querySelector(tableSelector) && !doc.querySelector(noDataSelector)) {
  //     console.log(`[Content Script] Neither table nor 'no data' found initially for ${settlementMonth}. Starting observer.`);
  //     // 예전에는 여기서 빈 데이터를 보냈으나, 이제는 Observer를 시작함
  // }

  // MutationObserver 설정
  console.log("[Content Script] Setting up MutationObserver.");
  observer = new MutationObserver((mutations, obs) => {
    // console.log("[Content Script] MutationObserver triggered. Checking content...");
    if (checkContentAndCallback()) {
      // 콜백 호출 및 cleanup은 checkContentAndCallback 내부에서 처리됨
    }
  });

  // 타임아웃 설정
  timeoutId = setTimeout(() => {
    console.warn(`[Content Script] Timeout waiting for table or 'no data' indicator for ${searchDateYYYYMM}. Sending empty array.`);
    callback([], settlementMonth); // 타임아웃 시 빈 배열 전송
    cleanup();
  }, TIMEOUT_DURATION);

  // 옵저버 시작 (DOM 로드 상태 고려)
  const startObserver = () => {
    if (doc.body) {
      observer.observe(doc.body, { childList: true, subtree: true });
      console.log("[Content Script] MutationObserver started.");
      // 옵저버 시작 후 즉시 다시 확인 (옵저버 설정 전에 이미 요소가 로드되었을 수 있음)
      if (checkContentAndCallback()) {
         return;
      }
    } else {
      console.error("[Content Script] document.body not available to start observer. Sending empty array.");
      callback([], settlementMonth); // body 없으면 실패 처리
      cleanup();
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

  // 오버레이들을 담을 최상위 컨테이너 생성 (기존 로직 활용 또는 수정)
  let overlayRootContainer = document.getElementById('munpiaExtensionOverlays');
  if (!overlayRootContainer) {
    overlayRootContainer = document.createElement('div');
    overlayRootContainer.id = 'munpiaExtensionOverlays';
    // Flexbox 스타일 적용하여 왼쪽 하단에 세로로 쌓이도록 설정
    overlayRootContainer.style.position = 'fixed';
    overlayRootContainer.style.bottom = '20px';
    overlayRootContainer.style.left = '20px';
    overlayRootContainer.style.zIndex = '10000'; // 다른 요소 위에 표시되도록 z-index 설정
    overlayRootContainer.style.display = 'flex';
    overlayRootContainer.style.flexDirection = 'column-reverse'; // 아래쪽 오버레이부터 표시
    overlayRootContainer.style.alignItems = 'flex-start'; // 왼쪽 정렬
    document.body.appendChild(overlayRootContainer);
  }

  // SyncOverlay와 UploadOverlay를 함께 렌더링
  render(html`
    <${Fragment}>
      <${SyncOverlay} />
      <${UploadOverlay} />
    </${Fragment}>
  `, overlayRootContainer);


} else {
  // 그 외 Munpia 페이지 (아무 작업 안 함)
  // console.log("Not a target page for the extension.");
}
