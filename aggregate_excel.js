// aggregate_excel.js
const fs = require('fs-extra');
const path = require('path');
const XLSX = require('xlsx');

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const OUTPUT_FILE = path.join(__dirname, 'aggregated.xlsx');

const STANDARD_HEADERS = [
  "작가명",
  "작품명",
  "출판사",
  "판매월",
  "총매출",
  "순매출",
  "정산액"
];

/**
 * 헤더 매핑: 조건에 맞게 텍스트를 비교하여 표준 헤더명을 반환함.
 */
function mapHeaderRow(headerRow) {
  const mapping = {};
  headerRow.forEach((cell, index) => {
    const text = cell ? cell.toString().trim() : "";
    if (text.includes("작가명") || text.includes("작가") || text.includes("필명") || text.includes("저자명") || text.includes("저자"))
      mapping[index] = "작가명";
    else if (text.includes("작품명") || text.includes("작품")  || text.includes("컨텐츠") || text.includes("제목") || text.includes("상품명"))
      mapping[index] = "작품명";
    else if (text.includes("출판사"))
      mapping[index] = "출판사";
    else if (text.includes("판매월") || text.includes("월") || text.includes("판매출"))
      mapping[index] = "판매월";
    else if (text.includes("총매출") || text.includes("총매출액") || text.includes("총판매") || text.includes("총매술"))
      mapping[index] = "총매출";
    else if (text.includes("순매출") || text.includes("순매출액"))
      mapping[index] = "순매출";
    else if (text.includes("정산액")  || text.includes("정산") || text.includes("지급액") || text.includes("정산금") || text.includes("금액"))
      mapping[index] = "정산액";
  });
  return mapping;
}

/**
 * 시트의 2차원 배열(rows)에서 첫 번째로 표준 헤더 7개가 모두 포함된 행을 찾아, 그 아래 데이터를 추출합니다.
 * 조건: 
 * - 행의 셀 수가 헤더 행과 동일해야 하며,
 * - 행 전체가 빈 셀이거나, 셀 중 하나라도 빈 문자열이면 그 행은 건너뜁니다.
 * - "실지급액" 또는 "합계"가 첫 셀에 있으면 건너뜁니다.
 * - 테이블의 끝(빈 행 또는 셀 수 불일치)이 감지되면 반복문 종료.
 */
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
    if (!row || row.every(cell => cell.toString().trim() === "")) break;
    if (row.length !== headerLength) break;
    const firstCell = row[0] ? row[0].toString().trim() : "";
    if (firstCell === "실지급액" || firstCell === "합계") continue;
    const rowData = {};
    let hasBlank = false;
    STANDARD_HEADERS.forEach(standardHeader => {
      const colIndex = Object.keys(headerMapping).find(key => headerMapping[key] === standardHeader);
      const value = (colIndex !== undefined && row[colIndex] != null) ? row[colIndex].toString().trim() : "";
      if (value === "") hasBlank = true;
      rowData[standardHeader] = value;
    });
    if (hasBlank) continue;
    data.push(rowData);
  }
  return data;
}

/**
 * 출판사별 요약 데이터를 계산합니다.
 */
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
    const totalSales = parseFloat(String(row["총매출"]).replace(/[^0-9.-]/g, "")) || 0;
    const netSales   = parseFloat(String(row["순매출"]).replace(/[^0-9.-]/g, "")) || 0;
    const settlement = parseFloat(String(row["정산액"]).replace(/[^0-9.-]/g, "")) || 0;
    summary[publisher].총매출 += totalSales;
    summary[publisher].순매출 += netSales;
    summary[publisher].정산액 += settlement;
  });
  return Object.values(summary);
}

/**
 * 헤더 셀에 중앙 정렬 및 굵은 글꼴 적용
 */
function applyHeaderStyle(sheet) {
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let C = range.s.c; C <= range.e.c; C++) {
    const cellAddress = XLSX.utils.encode_cell({ c: C, r: range.s.r });
    if (!sheet[cellAddress]) continue;
    // s 속성: font, alignment 등 (xlsx 스타일은 제한적)
    sheet[cellAddress].s = {
      font: { bold: true },
      alignment: { horizontal: "center", vertical: "center" }
    };
  }
}

/**
 * 합계 행(총합 행)에 특별한 서식(굵게, 중앙 정렬)을 적용
 */
function applyTotalRowStyle(sheet, totalRowNumber) {
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let C = range.s.c; C <= range.e.c; C++) {
    const cellAddress = XLSX.utils.encode_cell({ c: C, r: totalRowNumber });
    if (!sheet[cellAddress]) continue;
    sheet[cellAddress].s = {
      font: { bold: true },
      alignment: { horizontal: "center", vertical: "center" },
      fill: { fgColor: { rgb: "FFFFCC" } } // 연한 노란색 배경 예시
    };
  }
}

/**
 * 모든 시트에 대해 판매월은 날짜 형식(yyyy-mm)으로, 금액열은 숫자형 정수 쉼표 스타일(#,##0)으로 적용하고,
 * 지정한 열 너비를 설정합니다.
 */
function applySheetFormats(sheet, isAggregated) {
  const ref = sheet["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  // 판매월은 AggregatedData 시트에서는 네 번째 열 (D열)
  if (isAggregated) {
    for (let R = range.s.r + 1; R <= range.e.r; R++) {
      const cellAddress = XLSX.utils.encode_cell({ c: 3, r: R });
      const cell = sheet[cellAddress];
      if (cell && cell.v) {
        const d = new Date(cell.v);
        if (!isNaN(d)) {
          cell.v = d;
          cell.t = "d";
          cell.z = "yyyy-mm";
        }
      }
    }
  }
  // 금액 열: AggregatedData -> E,F,G; Summary -> C,D,E
  const targetCols = isAggregated ? ["E", "F", "G"] : ["C", "D", "E"];
  Object.keys(sheet).forEach(cellAddress => {
    if (cellAddress[0] === "!") return;
    const colLetters = cellAddress.match(/^[A-Z]+/)[0];
    if (targetCols.includes(colLetters)) {
      const cell = sheet[cellAddress];
      // 숫자로 변환
      let num = Number(cell.v);
      if (!isNaN(num)) {
        cell.v = num;
        cell.t = "n";
      }
      cell.z = "#,##0";
    }
  });
  // 열 너비 지정
  if (isAggregated) {
    sheet["!cols"] = [
      { wch: 10 },  // 작가명
      { wch: 20 },  // 작품명
      { wch: 10 },  // 출판사
      { wch: 8 },   // 판매월
      { wch: 11 },  // 총매출
      { wch: 11 },  // 순매출
      { wch: 11 }   // 정산액
    ];
  } else {
    sheet["!cols"] = [
      { wch: 10 },  // 출판사
      { wch: 8 },   // 건수
      { wch: 11 },  // 총매출
      { wch: 11 },  // 순매출
      { wch: 11 }   // 정산액
    ];
  }
}

/**
 * 전체 데이터 통합 및 Summary 시트 생성
 */
async function aggregateExcelFiles() {
  const aggregatedData = [];
  const files = await fs.readdir(DOWNLOADS_DIR);
  const excelFiles = files.filter(file => file.endsWith('.xls') || file.endsWith('.xlsx'));
  for (const file of excelFiles) {
    const filePath = path.join(DOWNLOADS_DIR, file);
    console.log(`처리 중: ${filePath}`);
    try {
      const workbook = XLSX.readFile(filePath);
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      const data = extractTableData(rows);
      aggregatedData.push(...data);
    } catch (err) {
      console.error(`파일 처리 실패 [${file}]:`, err);
    }
  }
  console.log(`전체 ${aggregatedData.length}개의 데이터 행을 취합했습니다.`);
  const newWorkbook = XLSX.utils.book_new();

  // AggregatedData 시트 생성
  const aggregatedSheet = XLSX.utils.json_to_sheet(aggregatedData, { header: STANDARD_HEADERS });
  aggregatedSheet["!autofilter"] = { ref: `A1:G${aggregatedData.length + 1}` };
  applyHeaderStyle(aggregatedSheet);
  applySheetFormats(aggregatedSheet, true);
  XLSX.utils.book_append_sheet(newWorkbook, aggregatedSheet, "AggregatedData");

  // Summary 시트 생성
  const summaryData = computeSummary(aggregatedData);
  const summaryHeaders = ["출판사", "건수", "총매출", "순매출", "정산액"];
  const summarySheet = XLSX.utils.json_to_sheet(summaryData, { header: summaryHeaders });
  let summaryRowCount = summaryData.length + 1; // 헤더 포함
  summarySheet["!autofilter"] = { ref: `A1:E${summaryRowCount}` };
  applyHeaderStyle(summarySheet);
  // 합계 행 추가
  let total총매출 = 0, total순매출 = 0, total정산액 = 0;
  summaryData.forEach(row => {
    total총매출 += row["총매출"] || 0;
    total순매출 += row["순매출"] || 0;
    total정산액 += row["정산액"] || 0;
  });
  const totalRow = {
    출판사: "합계",
    건수: "",
    총매출: total총매출,
    순매출: total순매출,
    정산액: total정산액
  };
  XLSX.utils.sheet_add_json(summarySheet, [totalRow], { skipHeader: true, origin: -1 });
  summaryRowCount++;
  summarySheet["!autofilter"] = { ref: `A1:E${summaryRowCount}` };
  applyTotalRowStyle(summarySheet, summaryRowCount - 1);
  applySheetFormats(summarySheet, false);
  XLSX.utils.book_append_sheet(newWorkbook, summarySheet, "Summary");

  XLSX.writeFile(newWorkbook, OUTPUT_FILE);
  console.log(`취합 파일이 저장되었습니다: ${OUTPUT_FILE}`);
}


module.exports = {aggregateExcelFiles};