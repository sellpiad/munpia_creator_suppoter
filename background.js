// background.js

// --- IndexedDB 설정 ---
const DB_NAME = 'excelDataDB';
const DB_VERSION = 3; // 모든 파일에서 동일하게 3으로 통일
const STORE_NAME = 'settlements';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      console.log('IndexedDB upgrade needed. New version:', event.newVersion);
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { autoIncrement: true });
        store.createIndex('salesMonth', '판매월', { unique: false });
        store.createIndex('정산월', '정산월', { unique: false });
        store.createIndex('작품명', '작품명', { unique: false });
        console.log('IndexedDB object store created/updated with indexes.');
      } else {
         const transaction = event.target.transaction;
         const store = transaction.objectStore(STORE_NAME);
         if (!store.indexNames.contains('정산월')) {
             store.createIndex('정산월', '정산월', { unique: false });
             console.log('Added index: 정산월');
         }
         if (!store.indexNames.contains('작품명')) {
             store.createIndex('작품명', '작품명', { unique: false });
             console.log('Added index: 작품명');
         }
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

// 특정 월의 데이터 삭제 함수
async function deleteDataForMonth(settlementMonthYYYYMM) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('정산월');
    const range = IDBKeyRange.only(settlementMonthYYYYMM);
    const request = index.openCursor(range);
    let deleteCount = 0;
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        deleteCount++;
        cursor.continue();
      }
    };
    transaction.oncomplete = () => {
      console.log(`Deleted ${deleteCount} existing records for month ${settlementMonthYYYYMM}.`);
      db.close();
      resolve(deleteCount);
    };
    transaction.onerror = (event) => {
      console.error(`Transaction error during deletion for month ${settlementMonthYYYYMM}:`, event.target.error);
      db.close();
      reject(event.target.error);
    };
  });
}


// 데이터 저장 (월별 작품 데이터 배열 저장, 저장 전 해당 월 데이터 삭제)
async function saveDataToDB(settlementMonthYYYYMM, novelDataArray) {
  if (!settlementMonthYYYYMM || !Array.isArray(novelDataArray)) {
    return Promise.reject(new Error("Invalid arguments for saveDataToDB"));
  }
  try {
    await deleteDataForMonth(settlementMonthYYYYMM);
    if (novelDataArray.length === 0) {
      return Promise.resolve();
    }
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      let successCount = 0;
      let errorOccurred = false;
      novelDataArray.forEach(item => {
        const amount = item['정산금액'];
        if (typeof amount !== 'number' || isNaN(amount)) {
            console.warn(`[Background] Invalid amount type or NaN for ${item['작품명']} in ${settlementMonthYYYYMM}. Skipping record.`);
            return;
        }
        const recordToSave = { '정산월': settlementMonthYYYYMM, '작품명': item['작품명'], '정산금액': amount };
        const request = store.add(recordToSave);
        request.onsuccess = () => { successCount++; };
        request.onerror = (event) => {
          if (!errorOccurred) {
            errorOccurred = true;
            console.error('Error adding item to IndexedDB:', event.target.error, 'Item:', recordToSave);
          }
        };
      });
      transaction.oncomplete = () => {
        console.log(`IndexedDB: Successfully added ${successCount} new records for ${settlementMonthYYYYMM}.`);
        db.close();
        if (!errorOccurred) resolve();
        else reject(new Error(`일부 데이터 저장 중 오류 발생 (${settlementMonthYYYYMM})`));
      };
      transaction.onerror = (event) => {
        console.error(`IndexedDB transaction error for ${settlementMonthYYYYMM}:`, event.target.error);
        db.close();
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error(`Error in saveDataToDB process for ${settlementMonthYYYYMM}:`, error);
    return Promise.reject(error);
  }
}

// 특정 연도의 월별 합계 (기존 함수 유지, 필요시 사용)
async function getExternalMonthlySum(year) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('정산월');
    const monthlySums = {};
    const lowerBound = `${year}.01`;
    const upperBound = `${year}.12`;
    const range = IDBKeyRange.bound(lowerBound, upperBound, false, false);
    const request = index.openCursor(range);
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        const settlementMonth = record['정산월'];
        const settlementAmount = record['정산금액'] || 0;
        const formattedMonth = settlementMonth.replace('.', '-');
        if (!monthlySums[formattedMonth]) monthlySums[formattedMonth] = 0;
        monthlySums[formattedMonth] += settlementAmount;
        cursor.continue();
      } else {
        db.close(); resolve(monthlySums);
      }
    };
    request.onerror = (event) => { db.close(); reject(event.target.error); };
  });
}

// 전체 데이터 로드 (기존 함수 유지, 필요시 사용)
async function loadDataFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = (event) => { resolve(event.target.result); db.close(); };
    request.onerror = (event) => { reject(event.target.error); db.close(); };
  });
}

// 레코드 수 조회 (기존 함수 유지)
async function getRecordCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.count();
    request.onsuccess = () => { resolve(request.result); db.close(); };
    request.onerror = (event) => { reject(event.target.error); db.close(); };
  });
}

// 전체 정산액 합계 계산
async function calculateTotalSum() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    let totalSum = 0;
    let recordCount = 0;
    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        const amount = record['정산금액'];
        // console.log(`[Background] calculateTotalSum - Record ${cursor.primaryKey}: amount = ${amount}, typeof amount = ${typeof amount}`);
        if (typeof amount === 'number' && !isNaN(amount)) {
            totalSum += amount;
        } else {
            console.warn(`[Background] calculateTotalSum: Invalid amount found in record ${cursor.primaryKey}:`, record);
        }
        recordCount++;
        cursor.continue();
      } else {
        console.log(`[Background] calculateTotalSum: Calculated total ${totalSum} from ${recordCount} records.`);
        resolve(totalSum);
        db.close();
      }
    };
    request.onerror = (event) => {
      console.error('[Background] Error calculating total sum:', event.target.error);
      reject(event.target.error);
      db.close();
    };
  });
}

// 작품별 정산액 합계 계산 함수
async function calculateSumByTitle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const sumsByTitle = {};
    let recordCount = 0;
    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        const title = record['작품명'];
        const amount = record['정산금액']; // 오타 수정됨
        const isTitleValid = !!title;
        const isAmountValid = typeof amount === 'number' && !isNaN(amount);
        // console.log(`[Background] calculateSumByTitle - Record ${cursor.primaryKey}: title="${title}" (Valid: ${isTitleValid}), amount=${amount} (Type: ${typeof amount}, Valid: ${isAmountValid})`);
        if (isTitleValid && isAmountValid) {
          if (!sumsByTitle[title]) sumsByTitle[title] = 0;
          sumsByTitle[title] += amount;
        } else {
             console.warn(`[Background] calculateSumByTitle: Skipping record ${cursor.primaryKey} due to invalid title or amount.`, record);
        }
        recordCount++;
        cursor.continue();
      } else {
        console.log(`[Background] calculateSumByTitle: Calculated sums for ${Object.keys(sumsByTitle).length} titles from ${recordCount} records.`);
        resolve(sumsByTitle);
        db.close();
      }
    };
    request.onerror = (event) => {
      console.error('[Background] Error calculating sum by title:', event.target.error);
      reject(event.target.error);
      db.close();
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
          const totalSum = await calculateTotalSum();
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
  if (message.type === 'startFullSync') {
    if (isSyncing) {
      sendResponse({ status: 'error', message: '이미 동기화가 진행 중입니다.' });
      return false;
    }
    console.log("Received startFullSync request from tab:", sender.tab?.id);
    mainUiTabId = sender.tab?.id; // 동기화 시작한 탭 ID 저장
    if (!mainUiTabId) {
        console.error("Cannot start sync: Sender tab ID is missing.");
        sendResponse({ status: 'error', message: '요청 탭 ID를 확인할 수 없습니다.' });
        return false;
    }

    isSyncing = true;
    failedSyncMonths = [];
    syncQueue = [];

    const startYear = message.startDate?.year || 2011;
    const startMonth = message.startDate?.month || 1;
    const currentFullYear = new Date().getFullYear();
    const currentJsMonth = new Date().getMonth();

    for (let year = startYear; year <= currentFullYear; year++) {
      const loopStartMonth = (year === startYear) ? startMonth : 1;
      const loopEndMonth = (year === currentFullYear) ? (currentJsMonth + 1) : 12;
      for (let month = loopStartMonth; month <= loopEndMonth; month++) {
        syncQueue.push(`${year}${String(month).padStart(2, '0')}`);
      }
    }

    if (syncQueue.length > 0) {
        console.log(`Sync queue created with ${syncQueue.length} months.`);
        processSyncQueue();
        sendResponse({ status: 'started' });
    } else {
        console.warn("Sync queue is empty.");
        isSyncing = false;
        mainUiTabId = null;
        sendResponse({ status: 'error', message: '동기화할 기간이 없습니다.' });
    }
    return false;

  } else if (message.type === 'cancelSync') {
      if (!isSyncing) {
          sendResponse({ status: 'not_syncing' });
          return false;
      }
      console.log("Received cancelSync request.");
      isSyncing = false; // 취소 플래그

      if (currentSyncTabId) {
          try { chrome.tabs.remove(currentSyncTabId); } catch (e) { /* ignore */ }
          currentSyncTabId = null;
      }
      clearTimeout(syncTimeoutId); syncTimeoutId = null;
      syncQueue = [];

      sendMessageToUiTab({ type: 'syncCancelled' }); // UI에 알림
      sendResponse({ status: 'cancelled' });
      mainUiTabId = null; // 취소 시 초기화
      console.log("Sync cancelled.");
      return false;

  } else if (message.type === 'parsedMonthlyData') {
      if (!isSyncing) {
          if (sender.tab?.id) { try { chrome.tabs.remove(sender.tab.id); } catch(e) {} }
          return false;
      }
      if (!sender.tab || sender.tab.id !== currentSyncTabId) {
          if (sender.tab?.id) { try { chrome.tabs.remove(sender.tab.id); } catch(e) {} }
          return false;
      }

      clearTimeout(syncTimeoutId); syncTimeoutId = null;
      const tabIdToClose = sender.tab.id;
      currentSyncTabId = null;

      const { settlementMonth, novelData } = message.data;
      console.log(`Received parsed data for ${settlementMonth}: ${novelData?.length || 0} items`);

      if (settlementMonth && novelData && Array.isArray(novelData)) {
          saveDataToDB(settlementMonth, novelData)
              .then(() => {
                  if (tabIdToClose) { try { chrome.tabs.remove(tabIdToClose); } catch(e) {} }
                  processSyncQueue();
              })
              .catch(err => {
                  console.error(`Error saving data for ${settlementMonth}:`, err);
                  const formattedMonth = settlementMonth.replace('.', '-');
                  if (tabIdToClose) { try { chrome.tabs.remove(tabIdToClose); } catch(e) {} }
                  handleSyncFailure(formattedMonth, 'DB 저장 실패');
              });
      } else {
          const formattedMonth = settlementMonth ? settlementMonth.replace('.', '-') : 'Unknown Month';
          if (tabIdToClose) { try { chrome.tabs.remove(tabIdToClose); } catch(e) {} }
          handleSyncFailure(formattedMonth, '데이터 파싱 실패 또는 없음');
      }
      return false;

  } else if (message.type === 'getTotalSum') {
      calculateTotalSum()
          .then(totalSum => sendResponse({ status: 'success', totalSum }))
          .catch(err => sendResponse({ status: 'error', message: err.message }));
      return true;
  } else if (message.type === 'getSumByTitle') {
      calculateSumByTitle()
          .then(sums => sendResponse({ status: 'success', sums }))
          .catch(err => sendResponse({ status: 'error', message: err.message }));
      return true;
  }
  else if (message.type === 'loadData') {
    loadDataFromDB()
      .then(data => sendResponse({ status: 'success', data }))
      .catch(err => sendResponse({ status: 'error', message: err.message }));
    return true;
  } else if (message.type === 'getExternalMonthlySum') {
    const year = message.year;
    getExternalMonthlySum(year)
      .then(sums => sendResponse({ status: 'success', sums }))
      .catch(err => sendResponse({ status: 'error', message: err.message }));
    return true;
  } else if (message.type === 'getRecordCount') {
    getRecordCount()
      .then(count => sendResponse({ status: 'success', count }))
      .catch(err => sendResponse({ status: 'error', message: err.message }));
    return true;
  }
  else if (message.type === 'openTab') {
    chrome.tabs.create({ url: message.url, active: true })
      .then(tab => sendResponse({ status: 'success', tabId: tab.id }))
      .catch(err => sendResponse({ status: 'error', message: err.message }));
    return true;
  } else if (message.type === 'closeTab') {
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

  console.log("Unhandled message type:", message.type);
  return false;
});
