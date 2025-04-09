import * as XLSX from 'xlsx';

// --- IndexedDB 설정 ---
// DB_NAME, DB_VERSION, STORE_NAME는 background.js와 동일하게 사용합니다.
const DB_NAME = 'excelDataDB';
const DB_VERSION = 3;
const STORE_NAME = 'settlements';

// 팝업에서는 이제 DB 작업을 background.js를 통해 처리하므로 직접 openDB()는 사용하지 않습니다.

// --- 데이터 처리 로직 (aggregate_excel.js 기반) ---
const STANDARD_HEADERS = [
  "작가명", "작품명", "출판사", "판매월", "총매출", "순매출", "정산액"
];

function mapHeaderRow(headerRow) {
  const mapping = {};
  headerRow.forEach((cell, index) => {
    const text = cell ? cell.toString().trim() : "";
    if (text.includes("작가명") || text.includes("작가") || text.includes("필명") || text.includes("저자명") || text.includes("저자"))
      mapping[index] = "작가명";
    else if (text.includes("작품명") || text.includes("작품") || text.includes("컨텐츠") || text.includes("제목") || text.includes("상품명"))
      mapping[index] = "작품명";
    else if (text.includes("출판사"))
      mapping[index] = "출판사";
    else if (text.includes("판매월") || text.includes("월") || text.includes("판매출"))
      mapping[index] = "판매월";
    else if (text.includes("총매출") || text.includes("총매출액") || text.includes("총판매") || text.includes("총매술"))
      mapping[index] = "총매출";
    else if (text.includes("순매출") || text.includes("순매출액"))
      mapping[index] = "순매출";
    else if (text.includes("정산액") || text.includes("정산") || text.includes("지급액") || text.includes("정산금") || text.includes("금액"))
      mapping[index] = "정산액";
  });
  return mapping;
}

function extractTableData(rows) {
  if (!rows || rows.length === 0) return [];
  let headerMapping = null;
  let headerRowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const mapping = mapHeaderRow(row);
    const mappedHeaders = Object.values(mapping);
    const containsAll = STANDARD_HEADERS.every(header => mappedHeaders.includes(header));
    if (containsAll) {
      headerMapping = mapping;
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex === -1 || !headerMapping) {
    console.warn("조건에 맞는 헤더 행을 찾지 못했습니다.");
    return [];
  }
  const data = [];
  const headerLength = rows[headerRowIndex].length;
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(cell => cell == null || cell.toString().trim() === "")) break;
    if (row.length !== headerLength) break;
    const firstCell = row[0] ? row[0].toString().trim() : "";
    if (firstCell === "실지급액" || firstCell === "합계") continue;
    const rowData = {};
    let hasRequiredData = true;
    STANDARD_HEADERS.forEach(standardHeader => {
      const colIndex = Object.keys(headerMapping).find(key => headerMapping[key] === standardHeader);
      let value = (colIndex !== undefined && row[colIndex] != null) ? row[colIndex] : "";
      if (["총매출", "순매출", "정산액"].includes(standardHeader)) {
          if (typeof value === 'string') {
              value = parseFloat(value.replace(/[^0-9.-]/g, "")) || 0;
          } else if (typeof value === 'number') {
              value = value;
          } else {
              value = 0;
          }
      } else if (standardHeader === "판매월") {
          if (typeof value === 'number' && value > 1) {
              try {
                  const excelEpoch = new Date(1899, 11, 30);
                  const jsDate = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
                  if (!isNaN(jsDate.getTime())) {
                      const year = jsDate.getFullYear();
                      const month = jsDate.getMonth() + 1;
                      value = `${year}-${String(month).padStart(2, '0')}`;
                  } else {
                      value = value.toString();
                  }
              } catch (e) {
                   console.warn(`판매월 날짜 변환 오류 (값: ${row[colIndex]}):`, e);
                   value = value.toString();
              }
          } else {
              const dateStr = value.toString().replace(/[^0-9]/g, '');
              if (dateStr.length === 6) {
                  value = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}`;
              } else {
                  value = value.toString().trim();
              }
          }
      } else {
          value = value.toString().trim();
      }
      rowData[standardHeader] = value;
      if (["작가명", "작품명", "판매월", "정산액"].includes(standardHeader)) {
          if (standardHeader === "판매월" && !/^\d{4}-\d{2}$/.test(value)) {
              hasRequiredData = false;
          } else if (value === "" || (standardHeader !== "정산액" && value === 0)) {
              hasRequiredData = false;
          }
      }
    });
    if (hasRequiredData) {
      data.push(rowData);
    } else {
        console.warn("Skipping row due to missing required data or invalid format:", row);
    }
  }
  return data;
}

function computeSummary(data) {
  const summary = {};
  data.forEach(row => {
    const publisher = row["출판사"] ? row["출판사"].toString().trim() : "미지정";
    if (!publisher) return;
    if (!summary[publisher]) {
      summary[publisher] = {
        출판사: publisher,
        건수: 0,
        총매출: 0,
        순매출: 0,
        정산액: 0
      };
    }
    summary[publisher].건수 += 1;
    summary[publisher].총매출 += row["총매출"] || 0;
    summary[publisher].순매출 += row["순매출"] || 0;
    summary[publisher].정산액 += row["정산액"] || 0;
  });
  return Object.values(summary);
}

function formatNumber(num) {
  return num.toLocaleString('ko-KR');
}

function renderTables(aggregatedData) {
  // 취합 데이터 테이블 렌더링 (정산월을 첫 열로 추가)
  const aggregatedTableBody = document.getElementById('aggregatedTable').querySelector('tbody');
  aggregatedTableBody.innerHTML = '';
  aggregatedData.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row['정산월'] || ''}</td>
      <td>${row['작가명']}</td>
      <td>${row['작품명']}</td>
      <td>${row['출판사']}</td>
      <td>${row['판매월']}</td>
      <td>${formatNumber(row['총매출'])}</td>
      <td>${formatNumber(row['순매출'])}</td>
      <td>${formatNumber(row['정산액'])}</td>
    `;
    aggregatedTableBody.appendChild(tr);
  });
  // 요약 데이터 테이블 렌더링
  const summaryTableBody = document.getElementById('summaryTable').querySelector('tbody');
  const summaryTableFoot = document.getElementById('summaryTable').querySelector('tfoot');
  summaryTableBody.innerHTML = '';
  summaryTableFoot.innerHTML = '';
  const summaryData = computeSummary(aggregatedData);
  let totalCount = 0, totalTotalSales = 0, totalNetSales = 0, totalSettlement = 0;
  summaryData.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row['출판사']}</td>
      <td>${formatNumber(row['건수'])}</td>
      <td>${formatNumber(row['총매출'])}</td>
      <td>${formatNumber(row['순매출'])}</td>
      <td>${formatNumber(row['정산액'])}</td>
    `;
    summaryTableBody.appendChild(tr);
    totalCount += row['건수'];
    totalTotalSales += row['총매출'];
    totalNetSales += row['순매출'];
    totalSettlement += row['정산액'];
  });
  const totalRowTr = document.createElement('tr');
  totalRowTr.style.fontWeight = 'bold';
  totalRowTr.innerHTML = `
    <td>합계</td>
    <td>${formatNumber(totalCount)}</td>
    <td>${formatNumber(totalTotalSales)}</td>
    <td>${formatNumber(totalNetSales)}</td>
    <td>${formatNumber(totalSettlement)}</td>
  `;
  summaryTableFoot.appendChild(totalRowTr);
}

// Background messaging을 이용한 DB 저장 및 불러오기 요청 함수
function saveDataToBackground(data) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'saveData', data }, response => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (response.status === 'error') {
        reject(new Error(response.message));
      } else {
        resolve();
      }
    });
  });
}

function loadDataFromBackground() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'loadData' }, response => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (response.status === 'error') {
        reject(new Error(response.message));
      } else {
        resolve(response.data);
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // 팝업이 열릴 때 background DB에 저장된 데이터를 불러옵니다.
  try {
    const dataFromDB = await loadDataFromBackground();
    if (dataFromDB && dataFromDB.length > 0) {
      renderTables(dataFromDB);
    } else {
      document.getElementById('results').innerHTML = "<p>저장된 데이터가 없습니다.</p>";
    }
  } catch (error) {
    console.error("데이터 로드 오류:", error);
    alert("데이터를 불러오는 중 오류가 발생했습니다: " + error.message);
  }
  
  const inputYear = document.getElementById('inputYear');
  const inputMonth = document.getElementById('inputMonth');
  const fileInput = document.getElementById('fileInput');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const resultsDiv = document.getElementById('results');
  
  fileInput.addEventListener('change', async () => {
    const files = fileInput.files;
    if (!files || files.length === 0) {
      alert('엑셀 파일을 선택해주세요.');
      return;
    }
    loadingIndicator.classList.remove('hidden');
    resultsDiv.classList.add('hidden');
    const specifiedYear = inputYear.value.trim();
    const specifiedMonth = inputMonth.value.trim().padStart(2, '0');
    const 정산월 = `${specifiedYear}.${specifiedMonth}`;
    let allAggregatedData = [];
    const excelFiles = Array.from(files).filter(file => /\.(xlsx|xls)$/i.test(file.name));
    if (excelFiles.length === 0) {
      alert('선택된 파일 내에 처리할 엑셀 파일(.xlsx, .xls)이 없습니다.');
      loadingIndicator.classList.add('hidden');
      return;
    }
    try {
      for (const file of excelFiles) {
        console.log(`Processing file: ${file.name}`);
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target.result);
          reader.onerror = (error) => reject(error);
          reader.readAsArrayBuffer(file);
        });
        const workbook = XLSX.read(data, { type: 'array', cellDates: false });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
        const extractedData = extractTableData(rows);
        extractedData.forEach(row => {
          row["정산월"] = 정산월;
        });
        allAggregatedData.push(...extractedData);
      }
      // Background에 데이터 저장 요청
      await saveDataToBackground(allAggregatedData);
      // 저장 후 Background에서 데이터 불러오기
      const dataFromDB = await loadDataFromBackground();
      renderTables(dataFromDB);
      alert(`${dataFromDB.length}개의 레코드가 DB에 저장되어 불러왔습니다.`);
    } catch (error) {
      console.error('파일 처리 중 오류 발생:', error);
      alert(`파일 처리 중 오류가 발생했습니다: ${error.message}`);
    } finally {
      loadingIndicator.classList.add('hidden');
      resultsDiv.classList.remove('hidden');
    }
  });
});
