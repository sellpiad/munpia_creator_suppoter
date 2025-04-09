import { h, render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { Overlay } from './src/components/Overlay.js'; // Import Overlay component
import { DBStatusOverlay } from './src/components/DBStatusOverlay.js'; // Import DBStatusOverlay component

const html = htm.bind(h);

const DB_NAME = 'excelDataDB';
const DB_VERSION = 3;
const STORE_NAME = 'settlements';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      console.log('IndexedDB upgrade needed (or initial setup). Version:', event.newVersion);
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { autoIncrement: true });
        store.createIndex('salesMonth', '판매월', { unique: false });
        store.createIndex('정산월', '정산월', { unique: false });
        console.log('IndexedDB object store created.');
      }
    };
    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
    request.onerror = (event) => {
      console.error('IndexedDB error in content script:', event.target.errorCode);
      reject(event.target.error);
    };
  });
}

async function getMonthlySettlements(year) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('salesMonth');
    const monthlySums = {};
    const lowerBound = `${year}-01`;
    const upperBound = `${year}-12`;
    const range = IDBKeyRange.bound(lowerBound, upperBound);
    const request = index.openCursor(range);
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        const month = record['판매월'];
        const settlementAmount = record['정산액'] || 0;
        if (!monthlySums[month]) {
          monthlySums[month] = 0;
        }
        monthlySums[month] += settlementAmount;
        cursor.continue();
      } else {
        console.log(`IndexedDB data fetched for year ${year}:`, monthlySums);
        db.close();
        resolve(monthlySums);
      }
    };
    request.onerror = (event) => {
      console.error('Error fetching data from IndexedDB:', event.target.error);
      db.close();
      reject(event.target.error);
    };
  });
}

function findAmountElement(doc = document) {
  const spanSelector = 'span.calculatesinfo-module_sum-gIItm';
  const spanElements = doc.querySelectorAll(spanSelector);
  if (spanElements.length > 0) {
    const lastSpanElement = spanElements[spanElements.length - 1];
    const bElement = lastSpanElement.querySelector('b');
    if (bElement) {
      return bElement;
    } else {
      console.error(`Inner <b> element not found within the span: ${spanSelector}`);
      return null;
    }
  }
  console.error(`Target span element not found: ${spanSelector}`);
  return null;
}

function parseAmount(bElement) {
  if (!bElement || !bElement.textContent) {
    console.error("Amount <b> element not found or has no text content.");
    return null;
  }
  const numericString = bElement.textContent.replace(/[^0-9]/g, '');
  return parseInt(numericString, 10);
}

function waitForData(doc, callback) {
  const tryParse = () => {
    const bElement = findAmountElement(doc);
    if (bElement) {
      callback(parseAmount(bElement));
      return true;
    }
    return false;
  };
  if (tryParse()) return;
  let observer = null;
  const TIMEOUT_DURATION = 10000;
  const timeoutId = setTimeout(() => {
    console.warn("타임아웃: 지정 시간 내에 데이터를 찾지 못했습니다.");
    if (observer) observer.disconnect();
    callback(null);
  }, TIMEOUT_DURATION);
  const startObserver = () => {
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations, obs) => {
      console.log("MutationObserver triggered, trying to parse amount...");
      if (tryParse()) {
        obs.disconnect();
        observer = null;
        clearTimeout(timeoutId);
      }
    });
    if (doc.body) {
      observer.observe(doc.body, { childList: true, subtree: true });
      console.log("MutationObserver started on document.body");
    } else {
      console.warn("document.body not available yet for MutationObserver");
      doc.addEventListener('DOMContentLoaded', () => {
        if (doc.body) {
          observer.observe(doc.body, { childList: true, subtree: true });
          console.log("MutationObserver started after DOMContentLoaded");
        } else {
          console.error("document.body still not available after DOMContentLoaded");
        }
      }, { once: true });
    }
  };
  setTimeout(startObserver, 500);
}

const urlParams = new URL(window.location).searchParams;
const isSlave = urlParams.has("slave");

if (isSlave) {
  waitForData(document, function(amount) {
    const month = urlParams.get("searchDate");
    chrome.runtime.sendMessage({ type: 'monthlyData', month: month, amount: amount });
    chrome.runtime.sendMessage({ type: 'closeTab' });
  });
} else {
  // 메인 페이지(마스터 탭) 로직
  function App() {
    const [monthlyResults, setMonthlyResults] = useState({});
    const [externalMonthlySums, setExternalMonthlySums] = useState({});
    const [externalDataLoading, setExternalDataLoading] = useState(true);
    const [monthList, setMonthList] = useState([]);
    const [initialDataLoaded, setInitialDataLoaded] = useState(false);
    const [currentYear, setCurrentYear] = useState(null);
    useEffect(() => {
      chrome.runtime.sendMessage({ type: 'registerMaster' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error registering master:", chrome.runtime.lastError.message);
        } else {
          console.log("Master registered", response);
        }
      });
      const getValidSearchDate = (callback) => {
        const check = () => {
          const urlParams = new URL(window.location).searchParams;
          const searchDate = urlParams.get("searchDate");
          if (searchDate && searchDate.length === 6) {
            callback(searchDate);
          } else {
            console.log("Waiting for valid searchDate...");
            setTimeout(check, 500);
          }
        };
        check();
      };
      getValidSearchDate((currentSearchDate) => {
        const year = currentSearchDate.slice(0, 4);
        setCurrentYear(year);
        const currentMonthNum = parseInt(currentSearchDate.slice(4, 6), 10);
        const calculatedMonthList = [];
        for (let m = 1; m <= currentMonthNum; m++) {
          let mm = m.toString().padStart(2, '0');
          calculatedMonthList.push(`${year}-${mm}`);
        }
        setMonthList(calculatedMonthList);
        const initialResults = {};
        calculatedMonthList.forEach(month => initialResults[month] = null);
        setMonthlyResults(initialResults);
        waitForData(document, (amount) => {
          const currentMonthFormatted = `${year}-${currentSearchDate.slice(4, 6)}`;
          console.log(`Munpia data for ${currentMonthFormatted} found: ${amount}`);
          setMonthlyResults(prevResults => ({
            ...prevResults,
            [currentMonthFormatted]: amount !== null ? amount : undefined
          }));
          setInitialDataLoaded(true);
        });
        setExternalDataLoading(true);
        console.log(`[Content Script] Attempting to fetch external DB data for year: ${year} after a short delay.`);
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: 'getExternalMonthlySum', year: year }, (response) => {
            if (chrome.runtime.lastError || response.status === 'error') {
              console.error("[Content Script] Error fetching external DB data:", chrome.runtime.lastError || response.message);
              setExternalMonthlySums({});
            } else {
              console.log('[Content Script] Successfully fetched external DB data:', response.sums);
              setExternalMonthlySums(response.sums);
            }
            setExternalDataLoading(false);
          });
        }, 500);
      });
      const messageListener = (message, sender, sendResponse) => {
        if (message.type === 'monthlyData') {
          const year = message.month.slice(0, 4);
          const month = message.month.slice(4, 6);
          const formattedMonth = `${year}-${month}`;
          console.log(`Received Munpia data for ${formattedMonth}: ${message.amount}`);
          setMonthlyResults(prevResults => ({
            ...prevResults,
            [formattedMonth]: message.amount !== null ? message.amount : undefined
          }));
        }
      };
      chrome.runtime.onMessage.addListener(messageListener);
      return () => {
        console.log("Cleaning up App component listener.");
        chrome.runtime.onMessage.removeListener(messageListener);
      };
    }, []);
    useEffect(() => {
      if (initialDataLoaded && monthList.length > 0 && currentYear) {
        const currentSearchDate = new URL(window.location).searchParams.get("searchDate");
        const currentMonthFormatted = `${currentYear}-${currentSearchDate.slice(4, 6)}`;
        console.log("Initial data loaded, opening slave tabs...");
        monthList.forEach((month) => {
          if (month !== currentMonthFormatted) {
            const monthForUrl = month.replace('-', '');
            console.log(`Requesting tab for month: ${monthForUrl}`);
            chrome.runtime.sendMessage({
              type: 'openTab',
              url: `https://librarym.munpia.com/manage/calculate?tab=monthly&blogUrl=&searchDate=${monthForUrl}&slave=true`
            });
          }
        });
      }
    }, [initialDataLoaded, monthList, currentYear]);
    return html`<${Overlay} monthlyResults=${monthlyResults} monthList=${monthList} externalMonthlySums=${externalMonthlySums} externalDataLoading=${externalDataLoading} />`;
  }

  const overlayContainer = document.createElement('div');
  overlayContainer.id = 'dataFetcherOverlayContainer';
  document.body.appendChild(overlayContainer);
  render(html`<${App} />`, overlayContainer);
}

// DB 상태 오버레이 렌더링
const dbStatusContainer = document.createElement('div');
dbStatusContainer.id = 'dbStatusOverlayContainer';
document.body.appendChild(dbStatusContainer);
render(html`<${DBStatusOverlay} />`, dbStatusContainer);
