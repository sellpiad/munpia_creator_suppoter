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
        store.createIndex('정산월', '정산월', { unique: false });  // 정산월 인덱스 추가
        console.log('IndexedDB object store created with indexes.');
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

// 수정된 saveDataToDB: 기존 데이터를 삭제하지 않고, 새 데이터를 누적 저장
async function saveDataToDB(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    let count = 0;
    if (data.length === 0) {
      resolve();
      return;
    }
    data.forEach(item => {
      const addRequest = store.add(item);
      addRequest.onsuccess = () => {
        count++;
        if (count === data.length) {
          resolve();
        }
      };
      addRequest.onerror = (event) => {
        console.error('Error adding item to IndexedDB:', event.target.error);
        reject(new Error('데이터 저장 중 오류 발생'));
      };
    });
    
    transaction.oncomplete = () => {
      db.close();
    };
    transaction.onerror = (event) => {
      db.close();
      reject(event.target.error);
    };
  });
}

async function getExternalMonthlySum(year) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    // '정산월' 인덱스를 사용하여 해당 연도의 01~12월 범위를 조회합니다.
    const lowerBound = `${year}.01`;
    const upperBound = `${year}.12`;
    const range = IDBKeyRange.bound(lowerBound, upperBound);
    const monthlySums = {};
    const request = store.index('정산월').openCursor(range);
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        const key = cursor.key; // 예: "2025.04"
        // 오버레이에서는 "YYYY-MM" 형식으로 변환
        const formattedMonth = key.replace('.', '-');
        const settlementAmount = record["정산액"] || 0;
        if (!monthlySums[formattedMonth]) {
          monthlySums[formattedMonth] = 0;
        }
        monthlySums[formattedMonth] += settlementAmount;
        cursor.continue();
      } else {
        db.close();
        resolve(monthlySums);
      }
    };
    request.onerror = (event) => {
      db.close();
      reject(event.target.error);
    };
  });
}

async function loadDataFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = (event) => {
      resolve(event.target.result);
      db.close();
    };
    request.onerror = (event) => {
      reject(event.target.error);
      db.close();
    };
  });
}

async function getRecordCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      resolve(countRequest.result);
      db.close();
    };
    countRequest.onerror = (event) => {
      reject(event.target.error);
      db.close();
    };
  });
}

// --- 탭 관련 기존 메시지 처리 ---
let masterTabId = null;

// --- 메시지 핸들러 ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // DB 관련 메시지 처리
  if (message.type === 'saveData') {
    saveDataToDB(message.data)
      .then(() => sendResponse({ status: 'success' }))
      .catch(err => sendResponse({ status: 'error', message: err.message }));
    return true;
  } else if (message.type === 'loadData') {
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

  // 기존 탭 관련 메시지 처리
  if (message.type === 'registerMaster') {
    masterTabId = sender.tab.id;
    sendResponse({ status: 'registered' });
  } else if (message.type === 'monthlyData') {
    // 슬레이브 탭에서 받은 데이터를 마스터 탭으로 전달
    if (masterTabId !== null) {
      chrome.tabs.sendMessage(masterTabId, message);
    }
  } else if (message.type === 'openTab') {
    chrome.tabs.create({ url: message.url, active: false }, function (tab) {
      // 백그라운드에서 탭 열림
    });
  } else if (message.type === 'closeTab') {
    // sender의 탭 닫기
    if (sender.tab && sender.tab.id) {
      chrome.tabs.remove(sender.tab.id);
    }
  }
});
