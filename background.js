// background.js

// --- IndexedDB 설정 ---
const DB_NAME = 'excelDataDB';
const DB_VERSION = 4; // 버전 증가 (새 스토어 추가 위함)
const SYNC_STORE_NAME = 'settlements'; // 자동 동기화 데이터 스토어
const MANUAL_STORE_NAME = 'manual_settlements'; // 수동 업로드 데이터 스토어

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      console.log('IndexedDB upgrade needed. Old version:', event.oldVersion, 'New version:', event.newVersion);

      // 기존 'settlements' 스토어 생성 또는 확인
      if (!db.objectStoreNames.contains(SYNC_STORE_NAME)) {
        const syncStore = db.createObjectStore(SYNC_STORE_NAME, { autoIncrement: true });
        // syncStore.createIndex('salesMonth', '판매월', { unique: false }); // 이 인덱스는 사용되지 않는 것 같아 제거 고려
        syncStore.createIndex('정산월', '정산월', { unique: false });
        syncStore.createIndex('작품명', '작품명', { unique: false });
        console.log(`Object store "${SYNC_STORE_NAME}" created with indexes.`);
      } else if (event.oldVersion < 3) { // 버전 3 미만에서 업그레이드 시 인덱스 추가 (기존 로직 유지)
         const transaction = event.target.transaction;
         const store = transaction.objectStore(SYNC_STORE_NAME);
         if (!store.indexNames.contains('정산월')) {
             store.createIndex('정산월', '정산월', { unique: false });
             console.log(`Added index "정산월" to ${SYNC_STORE_NAME}`);
         }
         if (!store.indexNames.contains('작품명')) {
             store.createIndex('작품명', '작품명', { unique: false });
             console.log(`Added index "작품명" to ${SYNC_STORE_NAME}`);
         }
      }

      // 새로운 'manual_settlements' 스토어 생성
      if (!db.objectStoreNames.contains(MANUAL_STORE_NAME)) {
        const manualStore = db.createObjectStore(MANUAL_STORE_NAME, { autoIncrement: true });
        // 자동 동기화 데이터와 동일한 구조 및 인덱스 사용
        manualStore.createIndex('정산월', '정산월', { unique: false });
        manualStore.createIndex('작품명', '작품명', { unique: false });
        console.log(`Object store "${MANUAL_STORE_NAME}" created with indexes.`);
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
    request.onerror = (event) => {
      console.error('IndexedDB error in background:', event.target.errorCode);
      reject(event.target.error);
    };
  });
}

// 특정 월의 데이터 삭제 함수 (storeName 파라미터 추가)
async function deleteDataForMonth(storeName, settlementMonthYYYYMM) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
        return reject(new Error(`Object store "${storeName}" not found.`));
    }
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const index = store.index('정산월'); // '정산월' 인덱스 사용
    const range = IDBKeyRange.only(settlementMonthYYYYMM); // YYYY.MM 형식
    const request = index.openCursor(range); // 해당 월 데이터 커서 열기
    let deleteCount = 0;
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete(); // 레코드 삭제
        deleteCount++;
        cursor.continue(); // 다음 레코드로 이동
      }
    };
    transaction.oncomplete = () => {
      console.log(`Deleted ${deleteCount} existing records from "${storeName}" for month ${settlementMonthYYYYMM}.`);
      db.close();
      resolve(deleteCount); // 삭제된 레코드 수 반환
    };
    transaction.onerror = (event) => {
      console.error(`Transaction error during deletion from "${storeName}" for month ${settlementMonthYYYYMM}:`, event.target.error);
      db.close(); // 오류 시에도 DB 닫기
      reject(event.target.error);
    };
  });
}


// 데이터 저장 함수 (storeName 파라미터 추가)
async function saveDataToDB(storeName, settlementMonthYYYYMM, novelDataArray) {
  if (!settlementMonthYYYYMM || !Array.isArray(novelDataArray)) {
    return Promise.reject(new Error("Invalid arguments for saveDataToDB"));
  }
  try {
    // 저장 전 해당 월 데이터 삭제 로직은 이제 각 메시지 핸들러에서 호출됨

    if (novelDataArray.length === 0) {
      console.log(`No data to save for ${settlementMonthYYYYMM} in "${storeName}".`);
      return Promise.resolve({ savedCount: 0 }); // 저장할 데이터 없으면 성공 처리
    }

    const db = await openDB();
    return new Promise((resolve, reject) => {
       if (!db.objectStoreNames.contains(storeName)) {
           return reject(new Error(`Object store "${storeName}" not found.`));
       }
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      let successCount = 0;
      let errorOccurred = false;

      novelDataArray.forEach(item => {
        // 데이터 유효성 검사 강화 (필요 시)
        const amount = item['정산금액'];
        const title = item['작품명'];
        if (typeof amount !== 'number' || isNaN(amount)) {
            console.warn(`[Background] Invalid amount type or NaN for "${title}" in ${settlementMonthYYYYMM}. Skipping record.`);
            return; // 저장 안 함
        }
        if (!title) {
             console.warn(`[Background] Missing title in ${settlementMonthYYYYMM}. Skipping record.`);
             return; // 저장 안 함
        }
        // 저장할 데이터 객체 생성 (정산월, 작품명, 정산금액만 포함)
        const recordToSave = { '정산월': settlementMonthYYYYMM, '작품명': title, '정산금액': amount };
        const request = store.add(recordToSave);
        request.onsuccess = () => { successCount++; };
        request.onerror = (event) => {
          // 개별 저장 오류 로깅 (트랜잭션은 계속 진행될 수 있음)
          if (!errorOccurred) {
            errorOccurred = true; // 첫 오류만 로깅 (선택적)
            console.error(`Error adding item to "${storeName}":`, event.target.error, 'Item:', recordToSave);
          }
        };
      });

      transaction.oncomplete = () => {
        console.log(`IndexedDB: Successfully added ${successCount} new records to "${storeName}" for ${settlementMonthYYYYMM}.`);
        db.close();
        // 일부 오류가 있었더라도 트랜잭션은 완료될 수 있음
        if (!errorOccurred) resolve({ savedCount: successCount });
        else reject(new Error(`일부 데이터 저장 중 오류 발생 (${settlementMonthYYYYMM} in "${storeName}")`));
      };
      transaction.onerror = (event) => {
        console.error(`IndexedDB transaction error for "${storeName}" (${settlementMonthYYYYMM}):`, event.target.error);
        db.close(); // 트랜잭션 오류 시 DB 닫기
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error(`Error in saveDataToDB process for "${storeName}" (${settlementMonthYYYYMM}):`, error);
    return Promise.reject(error); // 에러 전파
  }
}

// 특정 연도의 월별 합계 함수 (storeName 파라미터 추가, 현재 미사용)
// 필요하다면 이 함수도 수정하여 사용할 수 있음
async function getExternalMonthlySum(storeName, year) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
        return reject(new Error(`Object store "${storeName}" not found.`));
    }
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index('정산월'); // '정산월' 인덱스 사용
    const monthlySums = {};
    const lowerBound = `${year}.01`; // YYYY.MM 형식
    const upperBound = `${year}.12`; // YYYY.MM 형식
    const range = IDBKeyRange.bound(lowerBound, upperBound, false, false); // 해당 연도의 모든 월 포함
    const request = index.openCursor(range);

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        const settlementMonth = record['정산월']; // YYYY.MM
        const settlementAmount = record['정산금액'] || 0;
        const formattedMonth = settlementMonth.replace('.', '-'); // YYYY-MM 형식으로 변환 (필요시)
        if (!monthlySums[formattedMonth]) monthlySums[formattedMonth] = 0;
        monthlySums[formattedMonth] += settlementAmount;
        cursor.continue();
      } else {
        // 커서 종료
        db.close();
        resolve(monthlySums);
      }
    };
    request.onerror = (event) => {
        console.error(`Error getting monthly sum from "${storeName}" for year ${year}:`, event.target.error);
        db.close();
        reject(event.target.error);
    };
  });
}

// 전체 데이터 로드 함수 (storeName 파라미터 추가, 현재 미사용)
async function loadDataFromDB(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
        return reject(new Error(`Object store "${storeName}" not found.`));
    }
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = (event) => { resolve(event.target.result); db.close(); };
    request.onerror = (event) => { reject(event.target.error); db.close(); };
  });
}

// 레코드 수 조회 함수 (storeName 파라미터 추가)
async function getRecordCount(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
        // 스토어가 없으면 0 반환 (오류 대신)
        console.warn(`Object store "${storeName}" not found for getRecordCount. Returning 0.`);
        return resolve(0);
        // return reject(new Error(`Object store "${storeName}" not found.`));
    }
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.count();
    request.onsuccess = () => { resolve(request.result); db.close(); };
    request.onerror = (event) => { reject(event.target.error); db.close(); };
  });
}

// 특정 스토어의 전체 정산액 합계 계산 함수 (storeName 파라미터 추가)
async function calculateTotalSum(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
       // 스토어가 없으면 0 반환 (오류 대신)
       console.warn(`Object store "${storeName}" not found for calculateTotalSum. Returning 0.`);
       return resolve(0);
       // return reject(new Error(`Object store "${storeName}" not found.`));
    }
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    let totalSum = 0;
    let recordCount = 0; // 합계 계산 시 레코드 수도 같이 세기 (디버깅용)
    const request = store.openCursor();

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        const amount = record['정산금액'];
        if (typeof amount === 'number' && !isNaN(amount)) {
            totalSum += amount;
        } else {
            // 유효하지 않은 금액 데이터 로깅
            console.warn(`[Background] calculateTotalSum from "${storeName}": Invalid amount found in record ${cursor.primaryKey}:`, record);
        }
        recordCount++;
        cursor.continue();
      } else {
        // 커서 종료
        console.log(`[Background] calculateTotalSum from "${storeName}": Calculated total ${totalSum} from ${recordCount} records.`);
        resolve(totalSum); // 최종 합계 반환
        db.close();
      }
    };
    request.onerror = (event) => {
      console.error(`[Background] Error calculating total sum from "${storeName}":`, event.target.error);
      reject(event.target.error);
      db.close(); // 오류 시 DB 닫기
    };
  });
}

// 작품별 정산액 합계 계산 함수 (storeName 파라미터 추가)
async function calculateSumByTitle(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
     if (!db.objectStoreNames.contains(storeName)) {
         // 스토어가 없으면 빈 객체 반환 (오류 대신)
         console.warn(`Object store "${storeName}" not found for calculateSumByTitle. Returning empty object.`);
         return resolve({});
         // return reject(new Error(`Object store "${storeName}" not found.`));
     }
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const sumsByTitle = {};
    let recordCount = 0; // 디버깅용
    const request = store.openCursor();

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        const title = record['작품명'];
        const amount = record['정산금액'];
        const isTitleValid = !!title;
        const isAmountValid = typeof amount === 'number' && !isNaN(amount);

        if (isTitleValid && isAmountValid) {
          if (!sumsByTitle[title]) sumsByTitle[title] = 0;
          sumsByTitle[title] += amount;
        } else {
             // 유효하지 않은 데이터 로깅
             console.warn(`[Background] calculateSumByTitle from "${storeName}": Skipping record ${cursor.primaryKey} due to invalid title or amount.`, record);
        }
        recordCount++;
        cursor.continue();
      } else {
        // 커서 종료
        console.log(`[Background] calculateSumByTitle from "${storeName}": Calculated sums for ${Object.keys(sumsByTitle).length} titles from ${recordCount} records.`);
        resolve(sumsByTitle); // 작품별 합계 객체 반환
        db.close();
      }
    };
    request.onerror = (event) => {
      console.error(`[Background] Error calculating sum by title from "${storeName}":`, event.target.error);
      reject(event.target.error);
      db.close(); // 오류 시 DB 닫기
    };
  });
}


// --- 동기화 상태 관리 ---
let isSyncing = false;
let syncQueue = [];
let failedSyncMonths = [];
let currentSyncTabId = null;
let syncTimeoutId = null;
let mainUiTabId = null; // 동기화를 시작한 UI 탭 ID 저장

const SYNC_TIMEOUT_DURATION = 30000;

// --- Helper: Send message to main UI tab ---
async function sendMessageToUiTab(message) {
  if (mainUiTabId !== null) {
    try {
      // console.log(`[Background] Sending message to UI tab ${mainUiTabId}:`, message);
      await chrome.tabs.sendMessage(mainUiTabId, message);
    } catch (error) {
      console.warn(`[Background] Failed to send message to UI tab ${mainUiTabId}:`, error.message);
      if (isSyncing && error.message.includes("Receiving end does not exist")) {
         console.log("[Background] UI tab seems closed. Cancelling sync.");
         isSyncing = false; // 동기화 중단
      }
      mainUiTabId = null; // 연결 불가
    }
  } else {
    // console.warn("[Background] Cannot send message: mainUiTabId is null.");
  }
}


// --- 순차적 동기화 로직 ---
async function processSyncQueue() {
  if (!isSyncing) {
    console.log("Sync cancelled or not running. Stopping queue processing.");
    if (currentSyncTabId) {
      try { await chrome.tabs.remove(currentSyncTabId); } catch (e) { /* ignore */ }
      currentSyncTabId = null;
    }
    clearTimeout(syncTimeoutId); syncTimeoutId = null;
    syncQueue = [];
    return;
  }

  if (syncQueue.length === 0) {
    currentSyncTabId = null;
    clearTimeout(syncTimeoutId); syncTimeoutId = null;
    console.log("Sync queue finished. Failed months:", failedSyncMonths);
    if (isSyncing) {
        isSyncing = false;
        try {
          // 완료 시 SYNC_STORE_NAME 기준 합계 계산
          const totalSum = await calculateTotalSum(SYNC_STORE_NAME);
          const messagePayload = { type: 'syncComplete', totalSum: totalSum, failedMonths: failedSyncMonths };
          console.log("[Background] Sending syncComplete message to UI tab:", messagePayload);
          await sendMessageToUiTab(messagePayload);
        } catch (error) {
          console.error("Error calculating total sum or sending message after sync:", error);
          await sendMessageToUiTab({ type: 'syncError', message: '최종 합계 계산 또는 메시지 전송 중 오류 발생' });
        }
    }
    mainUiTabId = null; // 완료 시 초기화
    return;
  }

  if (!isSyncing) return;

  const monthToProcess = syncQueue.shift();
  const year = monthToProcess.substring(0, 4);
  const month = monthToProcess.substring(4, 6);
  const formattedMonth = `${year}-${month}`;

  console.log(`Processing sync for: ${formattedMonth}`);
  sendMessageToUiTab({ type: 'progressUpdate', month: formattedMonth });

  const url = `https://librarym.munpia.com/manage/calculate?tab=monthly&blogUrl=&searchDate=${monthToProcess}&fetch=true`;

  try {
    const tab = await chrome.tabs.create({ url: url, active: false });
    if (!isSyncing) {
        try { await chrome.tabs.remove(tab.id); } catch(e) {}
        return;
    }
    currentSyncTabId = tab.id;
    console.log(`Opened tab ${currentSyncTabId} for ${formattedMonth}`);

    syncTimeoutId = setTimeout(async () => {
      if (isSyncing) {
          console.warn(`Timeout waiting for data from tab ${currentSyncTabId} (${formattedMonth})`);
          handleSyncFailure(formattedMonth, '데이터 로딩 시간 초과');
      } else {
          if (currentSyncTabId) {
             try { await chrome.tabs.remove(currentSyncTabId); } catch(e) { /* ignore */ }
             currentSyncTabId = null;
          }
      }
    }, SYNC_TIMEOUT_DURATION);

  } catch (error) {
    if (isSyncing) {
        console.error(`Error opening tab for ${formattedMonth}:`, error);
        handleSyncFailure(formattedMonth, '탭 열기 실패');
    }
  }
}

// 동기화 실패 처리 및 다음 큐 진행
async function handleSyncFailure(failedMonthFormatted, reason) {
  if (!isSyncing) {
      console.log(`Sync failure for ${failedMonthFormatted} ignored due to cancellation.`);
      if (currentSyncTabId) {
          try { await chrome.tabs.remove(currentSyncTabId); } catch(e) { /* ignore */ }
          currentSyncTabId = null;
      }
      clearTimeout(syncTimeoutId); syncTimeoutId = null;
      return;
  }

  console.error(`Sync failed for ${failedMonthFormatted}: ${reason}`);
  failedSyncMonths.push(failedMonthFormatted);
  clearTimeout(syncTimeoutId); syncTimeoutId = null;

  sendMessageToUiTab({ type: 'progressUpdate', month: failedMonthFormatted, error: reason });

  const tabIdToClose = currentSyncTabId;
  currentSyncTabId = null;
  if (tabIdToClose) {
    try { await chrome.tabs.remove(tabIdToClose); }
    catch (removeError) { console.warn(`Could not remove tab ${tabIdToClose}:`, removeError.message); }
  }

  setTimeout(processSyncQueue, 500);
}


// --- 메시지 핸들러 ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 자동 동기화 시작
  if (message.type === 'startFullSync') {
    if (isSyncing) {
      sendResponse({ status: 'error', message: '이미 자동 동기화가 진행 중입니다.' });
      return false; // 동기화 중복 방지
    }
    console.log("Received startFullSync request from tab:", sender.tab?.id);
    mainUiTabId = sender.tab?.id; // UI 탭 ID 저장
    if (!mainUiTabId) {
        console.error("Cannot start sync: Sender tab ID is missing.");
        sendResponse({ status: 'error', message: '자동 동기화 요청 탭 ID를 확인할 수 없습니다.' });
        return false; // 탭 ID 없으면 시작 불가
    }

    // 동기화 상태 초기화 및 시작
    isSyncing = true;
    failedSyncMonths = [];
    syncQueue = [];
    const startYear = message.startDate?.year || 2011; // 기본 시작 년도
    const startMonth = message.startDate?.month || 1; // 기본 시작 월
    const currentFullYear = new Date().getFullYear();
    const currentJsMonth = new Date().getMonth(); // 0부터 시작 (0=1월)

    // 동기화할 월 목록 생성 (YYYYMM 형식)
    for (let year = startYear; year <= currentFullYear; year++) {
      const loopStartMonth = (year === startYear) ? startMonth : 1;
      // 현재 년도이면 현재 월까지만, 이전 년도이면 12월까지
      const loopEndMonth = (year === currentFullYear) ? (currentJsMonth + 1) : 12;
      for (let month = loopStartMonth; month <= loopEndMonth; month++) {
        syncQueue.push(`${year}${String(month).padStart(2, '0')}`);
      }
    }

    if (syncQueue.length > 0) {
        console.log(`Sync queue created with ${syncQueue.length} months for automatic sync.`);
        processSyncQueue(); // 동기화 큐 처리 시작
        sendResponse({ status: 'started' }); // 시작 성공 응답
    } else {
        console.warn("Automatic sync queue is empty.");
        isSyncing = false;
        mainUiTabId = null;
        sendResponse({ status: 'error', message: '자동 동기화할 기간이 없습니다.' });
    }
    return false; // 비동기 처리 아님 (processSyncQueue는 내부적으로 비동기)

  // 자동 동기화 취소
  } else if (message.type === 'cancelSync') {
      if (!isSyncing) {
          sendResponse({ status: 'not_syncing' }); // 이미 동기화 중이 아님
          return false;
      }
      console.log("Received cancelSync request.");
      isSyncing = false; // 동기화 중단 플래그 설정

      // 현재 진행 중인 탭 닫기 시도
      if (currentSyncTabId) {
          try { chrome.tabs.remove(currentSyncTabId); } catch (e) { console.warn("Failed to remove current sync tab on cancel:", e.message); }
          currentSyncTabId = null;
      }
      // 타임아웃 클리어 및 큐 비우기
      clearTimeout(syncTimeoutId); syncTimeoutId = null;
      syncQueue = [];

      sendMessageToUiTab({ type: 'syncCancelled' }); // UI에 취소 알림
      sendResponse({ status: 'cancelled' }); // 요청자에게 취소 성공 응답
      mainUiTabId = null; // UI 탭 ID 초기화
      console.log("Automatic sync cancelled.");
      return false; // 비동기 처리 아님

  // 자동 동기화 탭에서 파싱된 데이터 수신
  } else if (message.type === 'parsedMonthlyData') {
      // 동기화 중이 아니거나, 메시지를 보낸 탭이 현재 처리 중인 탭이 아니면 무시
      if (!isSyncing) {
          if (sender.tab?.id) { try { chrome.tabs.remove(sender.tab.id); } catch(e) {} } // 보낸 탭 닫기 시도
          return false; // 동기화 중 아님
      }
      if (!sender.tab || sender.tab.id !== currentSyncTabId) {
          console.warn(`Received parsedMonthlyData from unexpected tab ${sender.tab?.id}. Expected ${currentSyncTabId}.`);
          if (sender.tab?.id) { try { chrome.tabs.remove(sender.tab.id); } catch(e) {} } // 예상치 못한 탭 닫기 시도
          return false; // 예상치 못한 탭
      }

      clearTimeout(syncTimeoutId); syncTimeoutId = null; // 타임아웃 클리어
      const tabIdToClose = sender.tab.id;
      currentSyncTabId = null; // 현재 탭 ID 초기화

      const { settlementMonth, novelData } = message.data; // YYYY.MM 형식, 데이터 배열
      console.log(`Received parsed data for ${settlementMonth} (Auto Sync): ${novelData?.length || 0} items`);

      if (settlementMonth && novelData && Array.isArray(novelData)) {
          // 자동 동기화 데이터는 SYNC_STORE_NAME에 저장
          deleteDataForMonth(SYNC_STORE_NAME, settlementMonth) // 먼저 해당 월 데이터 삭제
              .then(() => saveDataToDB(SYNC_STORE_NAME, settlementMonth, novelData)) // 삭제 후 저장
              .then(() => {
                  if (tabIdToClose) { try { chrome.tabs.remove(tabIdToClose); } catch(e) {} } // 성공 시 탭 닫기
                  processSyncQueue(); // 다음 큐 처리
              })
              .catch(err => {
                  console.error(`Error saving auto-sync data for ${settlementMonth}:`, err);
                  const formattedMonth = settlementMonth.replace('.', '-');
                  if (tabIdToClose) { try { chrome.tabs.remove(tabIdToClose); } catch(e) {} } // 실패 시에도 탭 닫기
                  handleSyncFailure(formattedMonth, 'DB 저장 실패'); // 실패 처리 및 다음 큐
              });
      } else {
          // 데이터 파싱 실패 또는 빈 데이터
          const formattedMonth = settlementMonth ? settlementMonth.replace('.', '-') : 'Unknown Month';
          console.warn(`Parsed data for ${formattedMonth} (Auto Sync) is invalid or empty.`);
          if (tabIdToClose) { try { chrome.tabs.remove(tabIdToClose); } catch(e) {} } // 탭 닫기
          handleSyncFailure(formattedMonth, '데이터 파싱 실패 또는 없음'); // 실패 처리 및 다음 큐
      }
      return true; // 비동기 응답 처리 (saveDataToDB가 비동기)

  // --- UploadOverlay 관련 메시지 핸들러 ---

  // 수동 업로드 데이터 저장 요청
  } else if (message.type === 'saveManualUploadData') {
    const { settlementMonth, dataToSave } = message.data; // YYYY.MM, [{작품명, 정산금액}, ...]
    console.log(`Received saveManualUploadData for ${settlementMonth}, ${dataToSave?.length} items.`);
    if (!settlementMonth || !Array.isArray(dataToSave)) {
      sendResponse({ status: 'error', message: '잘못된 데이터 형식입니다 (manual upload).' });
      return false;
    }
    // 수동 업로드 데이터는 MANUAL_STORE_NAME에 저장
    deleteDataForMonth(MANUAL_STORE_NAME, settlementMonth) // 먼저 해당 월 데이터 삭제
      .then(() => saveDataToDB(MANUAL_STORE_NAME, settlementMonth, dataToSave)) // 삭제 후 저장
      .then((result) => {
        console.log(`Successfully saved manual upload data for ${settlementMonth}`);
        sendResponse({ status: 'success', savedCount: result.savedCount }); // 저장된 개수 응답
      })
      .catch(err => {
        console.error(`Error saving manual upload data for ${settlementMonth}:`, err);
        sendResponse({ status: 'error', message: `DB 저장 실패 (manual): ${err.message}` });
      });
    return true; // 비동기 응답 처리

  // SyncOverlay용 DB 상태 조회
  } else if (message.type === 'getSyncDbStatus') {
    Promise.all([
        getRecordCount(SYNC_STORE_NAME),
        calculateTotalSum(SYNC_STORE_NAME),
        calculateSumByTitle(SYNC_STORE_NAME) // 작품별 합계도 추가
    ])
      .then(([recordCount, totalSum, sumsByTitle]) => {
        sendResponse({ status: 'success', recordCount, totalSum, sums: sumsByTitle });
      })
      .catch(err => {
        console.error("Error getting Sync DB status:", err);
        sendResponse({ status: 'error', message: `동기화 DB 상태 조회 실패: ${err.message}` });
      });
    return true; // 비동기 응답 처리

  // UploadOverlay용 DB 상태 조회
  } else if (message.type === 'getUploadDbStatus') {
    Promise.all([
        getRecordCount(MANUAL_STORE_NAME),
        calculateTotalSum(MANUAL_STORE_NAME)
    ])
      .then(([recordCount, totalSum]) => {
        sendResponse({ status: 'success', recordCount, totalSum });
      })
      .catch(err => {
        console.error("Error getting Upload DB status:", err);
        sendResponse({ status: 'error', message: `업로드 DB 상태 조회 실패: ${err.message}` });
      });
    return true; // 비동기 응답 처리
  }
  // UploadOverlay용 전체 데이터 조회
  else if (message.type === 'getManualUploadData') {
    loadDataFromDB(MANUAL_STORE_NAME) // loadDataFromDB 함수 재활용
      .then(data => {
        sendResponse({ status: 'success', data: data || [] }); // 데이터 없으면 빈 배열
      })
      .catch(err => {
        console.error("Error getting Manual Upload Data:", err);
        sendResponse({ status: 'error', message: `업로드 데이터 조회 실패: ${err.message}` });
      });
    return true; // 비동기 응답 처리
  }
  // --- 핸들러 추가 끝 ---


  // --- 기타 기존 메시지 핸들러 ---
  // (getExternalMonthlySum 등은 현재 UI에서 직접 사용되지 않으므로 제거 또는 주석 처리 고려)
  // (openTab, closeTab은 유지)

  else if (message.type === 'openTab') {
    chrome.tabs.create({ url: message.url, active: true })
      .then(tab => sendResponse({ status: 'success', tabId: tab.id }))
      .catch(err => sendResponse({ status: 'error', message: err.message }));
    return true;
  } else if (message.type === 'closeTab') {
    // 이 메시지는 이제 사용되지 않을 수 있음 (탭 닫기는 각 로직 내부에서 처리)
    if (message.tabId) {
      chrome.tabs.remove(message.tabId)
        .then(() => sendResponse({ status: 'success' }))
        .catch(err => sendResponse({ status: 'error', message: err.message }));
      return true;
    } else if (sender.tab && sender.tab.id) {
       chrome.tabs.remove(sender.tab.id)
        .then(() => sendResponse({ status: 'success' }))
        .catch(err => sendResponse({ status: 'error', message: err.message }));
       return true;
    } else {
       sendResponse({ status: 'error', message: '닫을 탭 ID가 지정되지 않았습니다.' });
       return false;
    }
  }

  // 처리되지 않은 메시지 로깅
  console.log("Unhandled message type:", message.type, message);
  return false; // 동기 응답 (처리 안 함)
});
