import { h, Component } from 'preact';
import htm from 'htm';
import * as XLSX from 'xlsx';

const html = htm.bind(h);

// 로딩 아이콘 SVG (SyncOverlay와 동일하게 사용)
const LoadingIcon = () => html`
  <svg width="16" height="16" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid" style=${{display: 'inline-block', verticalAlign: 'middle', marginLeft: '5px'}}>
    <circle cx="50" cy="50" fill="none" stroke="#fff" stroke-width="10" r="35" stroke-dasharray="164.93361431346415 56.97787143782138">
      <animateTransform attributeName="transform" type="rotate" repeatCount="indefinite" dur="1s" values="0 50 50;360 50 50" keyTimes="0;1"></animateTransform>
    </circle>
  </svg>
`;

// --- 엑셀 파싱 로직 (클래스 외부 유지 또는 static 메서드로 변경 가능) ---
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
  const mappedHeaders = Object.values(mapping);
  const requiredHeaders = ["작가명", "작품명", "판매월", "정산액"];
  const hasRequired = requiredHeaders.every(h => mappedHeaders.includes(h));
  if (!hasRequired) {
      console.warn("필수 헤더(작가명, 작품명, 판매월, 정산액) 중 일부를 찾지 못했습니다.", mapping);
  }
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
    const containsAllStandard = STANDARD_HEADERS.every(header => mappedHeaders.includes(header));
    if (containsAllStandard) {
      headerMapping = mapping;
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex === -1 || !headerMapping) {
    console.warn("엑셀 시트에서 조건에 맞는 헤더 행을 찾지 못했습니다. (STANDARD_HEADERS 모두 포함 필요)");
    return [];
  }
  console.log("헤더 행 발견:", headerRowIndex, "매핑:", headerMapping);
  const data = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(cell => cell == null || cell.toString().trim() === "")) {
        console.log(`빈 행 발견 (행 ${i + 1}), 데이터 처리 종료.`);
        break;
    }
    const firstCell = row[0] ? row[0].toString().trim() : "";
    if (firstCell === "실지급액" || firstCell === "합계") {
        console.log(`합계 행 추정 (행 ${i + 1}), 건너<0xEB><0x9B><0x8D>니다.`);
        continue;
    }
    const rowData = {};
    let hasRequiredData = true;
    STANDARD_HEADERS.forEach(standardHeader => {
      const colIndex = Object.keys(headerMapping).find(key => headerMapping[key] === standardHeader);
      let value = (colIndex !== undefined && row[colIndex] != null) ? row[colIndex] : "";
      if (["총매출", "순매출", "정산액"].includes(standardHeader)) {
          if (typeof value === 'string') value = parseFloat(value.replace(/[^0-9.-]/g, "")) || 0;
          else if (typeof value !== 'number') value = 0;
      } else if (standardHeader === "판매월") {
          if (typeof value === 'number' && value > 1) {
              try {
                  const excelEpoch = new Date(1899, 11, 30);
                  const jsDate = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
                  if (!isNaN(jsDate.getTime())) {
                      const year = jsDate.getFullYear();
                      const month = jsDate.getMonth() + 1;
                      value = `${year}-${String(month).padStart(2, '0')}`;
                  } else value = value.toString();
              } catch (e) {
                   console.warn(`판매월 날짜 변환 오류 (값: ${row[colIndex]}):`, e); value = value.toString();
              }
          } else {
              const dateStr = value.toString().replace(/[^0-9]/g, '');
              if (dateStr.length === 6) value = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}`;
              else value = value.toString().trim();
          }
      } else value = value.toString().trim();
      rowData[standardHeader] = value;
      if (["작가명", "작품명", "판매월", "정산액"].includes(standardHeader)) {
          if (standardHeader === "판매월" && !/^\d{4}-\d{2}$/.test(value)) { hasRequiredData = false; console.warn(`행 ${i + 1}: 판매월 형식 오류 (${value}).`); }
          else if (value === "" || (standardHeader !== "정산액" && value === 0)) { hasRequiredData = false; console.warn(`행 ${i + 1}: 필수 항목(${standardHeader}) 누락/0.`); }
          else if (standardHeader === "정산액" && value === "") { hasRequiredData = false; console.warn(`행 ${i + 1}: 필수 항목(${standardHeader}) 누락.`); }
      }
    });
    if (hasRequiredData) data.push(rowData);
    else console.warn(`행 ${i + 1} 건너<0xEB><0x9B><0x8D>니다: 필수 데이터 부족/오류.`, row);
  }
  console.log(`총 ${data.length}개의 유효한 데이터 행 추출 완료.`);
  return data;
}


export class UploadOverlay extends Component {
  constructor() {
    super();
    this.state = {
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      statusMessage: '',
      recordCount: 0,
      totalSum: 0,
      isProcessing: false,
      manualData: [],
    };
    this.fileInputRef = null;
    this.abortController = null;
  }

  // --- Helper 함수들을 클래스 메서드로 이동 ---

  // Background messaging 함수
  saveDataToBackground = (data) => {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'saveManualUploadData', data }, response => {
        // 컨텍스트 무효화 오류 방지
        if (chrome.runtime.lastError) {
          console.warn("UploadOverlay: Context invalidated during save data.", chrome.runtime.lastError.message);
          reject(new Error('컨텍스트 무효화 (저장)')); // 오류 전파
          return;
        }
        // 기존 응답 처리
        if (response?.status === 'error') {
          console.error("Error from background during save:", response.message);
          reject(new Error(response.message));
        } else if (response?.status === 'success') {
          console.log("Background reported save success:", response);
          resolve(response);
        } else {
          console.error("Unknown response from background during save:", response);
          reject(new Error('백그라운드로부터 알 수 없는 응답'));
        }
      });
    });
  }

  // UploadOverlay용 DB 상태 조회 함수
  getUploadDbStatusFromBackground = () => {
     return new Promise((resolve, reject) => {
       chrome.runtime.sendMessage({ type: 'getUploadDbStatus' }, response => {
         // 컨텍스트 무효화 오류 방지
         if (chrome.runtime.lastError) {
           console.warn("UploadOverlay: Context invalidated during get DB status.", chrome.runtime.lastError.message);
           reject(new Error('컨텍스트 무효화 (상태 조회)')); // 오류 전파
           return;
         }
         // 기존 응답 처리
         if (response?.status === 'error') {
           console.error("Error from background fetching Upload DB status:", response.message);
           reject(new Error(response.message));
         } else if (response?.status === 'success') {
           resolve({ recordCount: response.recordCount, totalSum: response.totalSum });
         } else {
           console.error("Unknown response from background fetching Upload DB status:", response);
           reject(new Error('백그라운드로부터 알 수 없는 응답 (Upload DB)'));
         }
       });
     });
  }

  // UploadOverlay용 전체 데이터 조회 함수
  getManualUploadDataFromBackground = () => {
     return new Promise((resolve, reject) => {
       chrome.runtime.sendMessage({ type: 'getManualUploadData' }, response => {
         // 컨텍스트 무효화 오류 방지
         if (chrome.runtime.lastError) {
           console.warn("UploadOverlay: Context invalidated during get manual data.", chrome.runtime.lastError.message);
           reject(new Error('컨텍스트 무효화 (데이터 조회)')); // 오류 전파
           return;
         }
         // 기존 응답 처리
         if (response?.status === 'error') {
           console.error("Error from background fetching Manual Upload Data:", response.message);
           reject(new Error(response.message));
         } else if (response?.status === 'success') {
           resolve(response.data || []);
         } else {
           console.error("Unknown response from background fetching Manual Upload Data:", response);
           reject(new Error('백그라운드로부터 알 수 없는 응답 (Manual Upload Data)'));
         }
       });
     });
  }

  // --- 컴포넌트 라이프사이클 및 핸들러 ---

  componentDidMount() {
    this.updateDbStatus();
    this.loadManualData();
  }

  // Upload DB 상태 업데이트 함수
  updateDbStatus = async () => {
    this.setState({ statusMessage: '업로드 DB 상태 로딩 중...' });
    try {
      // 클래스 메서드 호출로 변경
      const { recordCount, totalSum } = await this.getUploadDbStatusFromBackground();
      this.setState({ recordCount, totalSum });
    } catch (error) {
      console.error("Error fetching Upload DB status:", error);
      this.setState({ statusMessage: `업로드 DB 상태 로드 오류: ${error.message}`, recordCount: '?', totalSum: '?' });
    }
  }

  // 수동 업로드 데이터 로드 함수
  loadManualData = async () => {
    this.setState({ statusMessage: '업로드 데이터 로딩 중...' });
    try {
      // 클래스 메서드 호출로 변경
      const data = await this.getManualUploadDataFromBackground();
      this.setState({ manualData: data, statusMessage: '' });
    } catch (error) {
      console.error("Error fetching Manual Upload Data:", error);
      this.setState({ statusMessage: `업로드 데이터 로드 오류: ${error.message}`, manualData: [] });
    }
  }

  handleYearChange = (e) => {
    this.setState({ year: e.target.value });
  }

  handleMonthChange = (e) => {
    this.setState({ month: e.target.value });
  }

  // 파일 선택 시 즉시 처리 시작
  handleFileChange = async (e) => {
    const files = e.target.files;
    const { year, month } = this.state;

    if (!files || files.length === 0) return;
    if (!year || !month) {
      alert('정산 년도와 월을 먼저 입력해주세요.');
      if (this.fileInputRef) this.fileInputRef.value = '';
      return;
    }

    if (this.abortController) this.abortController.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.setState({ isProcessing: true, statusMessage: '파일 처리 시작...' });

    const settlementMonth = `${year}.${String(month).padStart(2, '0')}`;
    let allExtractedData = [];
    const excelFiles = Array.from(files).filter(file => /\.(xlsx|xls)$/i.test(file.name));

    if (excelFiles.length === 0) {
      this.setState({ isProcessing: false, statusMessage: '선택된 파일 중 엑셀 파일이 없습니다.' });
      if (this.fileInputRef) this.fileInputRef.value = '';
      return;
    }

    this.setState({ statusMessage: `파일 ${excelFiles.length}개 처리 중...` });

    try {
      for (const file of excelFiles) {
        if (signal.aborted) { this.setState({ statusMessage: '사용자에 의해 취소됨.' }); return; }
        console.log(`Processing file: ${file.name}`);
        this.setState({ statusMessage: `${file.name} 처리 중...` });

        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target.result);
          reader.onerror = (error) => reject(error);
          signal.addEventListener('abort', () => reader.abort());
          reader.readAsArrayBuffer(file);
        });

        if (signal.aborted) { this.setState({ statusMessage: '사용자에 의해 취소됨.' }); return; }

        const workbook = XLSX.read(data, { type: 'array', cellDates: false });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
        const extractedData = extractTableData(rows); // 외부 함수 호출
        const dataToSave = extractedData.map(row => ({
          '정산월': settlementMonth,
          '작품명': row['작품명'],
          '정산금액': row['정산액']
        }));
        allExtractedData.push(...dataToSave);
      }

      if (signal.aborted) { this.setState({ statusMessage: '사용자에 의해 취소됨.' }); return; }

      if (allExtractedData.length === 0) {
          this.setState({ statusMessage: '처리할 유효한 데이터가 없습니다.' });
      } else {
          this.setState({ statusMessage: `데이터 ${allExtractedData.length}개 저장 중...` });
          // 클래스 메서드 호출로 변경
          await this.saveDataToBackground({ settlementMonth, dataToSave: allExtractedData });
          this.setState({ statusMessage: `${allExtractedData.length}개 레코드 저장 완료.` });
          await this.updateDbStatus();
          await this.loadManualData();
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('File processing aborted.');
        this.setState({ statusMessage: '파일 처리 취소됨.' });
      } else {
        console.error('파일 처리 또는 저장 중 오류 발생:', error);
        this.setState({ statusMessage: `오류: ${error.message}` });
      }
    } finally {
      this.setState({ isProcessing: false });
      if (this.fileInputRef) this.fileInputRef.value = '';
      this.abortController = null;
    }
  }

  // 취소 버튼 핸들러
  handleCancel = () => {
    if (this.abortController) {
      this.abortController.abort();
      console.log("Cancellation requested.");
    }
  }

  render(_, { year, month, isProcessing, statusMessage, recordCount, totalSum, manualData }) {
    // 스타일 정의
    const overlayStyle = {
      padding: '15px', backgroundColor: 'rgba(20, 20, 20, 0.9)', color: '#e0e0e0',
      fontFamily: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', fontSize: '13px',
      borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      minWidth: '320px', maxWidth: '450px', lineHeight: '1.6', marginBottom: '200px'
    };
    const inputGroupStyle = { display: 'flex', alignItems: 'center', marginBottom: '10px' };
    const labelStyle = { marginRight: '8px', color: '#bdbdbd', minWidth: '50px' };
    const inputStyle = {
      padding: '4px 8px', fontSize: '13px', backgroundColor: '#424242', color: '#e0e0e0',
      border: '1px solid #616161', borderRadius: '4px', marginRight: '5px', width: '60px'
    };
     const fileInputStyle = {
       color: '#e0e0e0', backgroundColor: '#424242', border: '1px solid #616161',
       borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', flexGrow: 1
     };
    const buttonStyle = {
      padding: '6px 12px', fontSize: '13px', fontWeight: '500', cursor: 'pointer',
      backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '4px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'background-color 0.2s ease', marginLeft: '10px'
    };
    const statusTextStyle = {
       marginTop: '8px', fontSize: '12px', color: '#bdbdbd', minHeight: '1.2em',
       display: 'flex', alignItems: 'center'
     };
    const dbStatusStyle = { marginTop: '10px', fontSize: '12px', color: '#9e9e9e' };
    const tableContainerStyle = { marginTop: '15px', maxHeight: '250px', overflowY: 'auto', borderTop: '1px solid #424242'};
    const tableStyle = { width: '100%', borderCollapse: 'collapse' };
    const thTdStyle = { padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #424242' };
    const thStyle = { ...thTdStyle, color: '#bdbdbd', fontWeight: '500', position: 'sticky', top: 0, backgroundColor: 'rgba(20, 20, 20, 0.9)' };
    const amountCellStyle = { textAlign: 'right' };

    // 테이블 행 생성
    const tableRows = manualData
      .sort((a, b) => (a.정산월 < b.정산월) ? 1 : (a.정산월 > b.정산월) ? -1 : (a.작품명 < b.작품명) ? -1 : 1)
      .map(item => html`
      <tr key=${item.id || `${item.정산월}-${item.작품명}`}>
        <td style=${thTdStyle}>${item.정산월}</td>
        <td style=${thTdStyle}>${item.작품명}</td>
        <td style=${{...thTdStyle, ...amountCellStyle}}>${item.정산금액.toLocaleString('ko-KR')} 원</td>
      </tr>
    `);

    return html`
      <div id="munpiaUploadOverlayContainer" style=${overlayStyle}>
        <h4 style=${{margin: '0 0 10px 0', color: '#bdbdbd', fontSize: '14px', fontWeight: '500'}}>엑셀 수동 업로드</h4>
        <div style=${inputGroupStyle}>
          <label style=${labelStyle}>정산월:</label>
          <input type="number" value=${year} onChange=${this.handleYearChange} min="2000" max="2099" style=${inputStyle} disabled=${isProcessing} /> 년
          <input type="number" value=${month} onChange=${this.handleMonthChange} min="1" max="12" style=${inputStyle} disabled=${isProcessing} /> 월
        </div>
        <div style=${inputGroupStyle}>
           <label for="excelFileInput" style=${labelStyle}>파일:</label>
           <input
             id="excelFileInput"
             type="file"
              ref=${(ref) => this.fileInputRef = ref}
              onChange=${this.handleFileChange}
              multiple
              accept=".xlsx, .xls"
              disabled=${isProcessing}
              style=${fileInputStyle}
           />
           ${isProcessing && html`<button onClick=${this.handleCancel} style=${buttonStyle}>취소</button>`}
        </div>

        ${statusMessage && html`
          <div style=${statusTextStyle}>
            ${isProcessing && html`<${LoadingIcon} />`}
            <span style=${{marginLeft: isProcessing ? '5px' : '0'}}>${statusMessage}</span>
          </div>
        `}

        <div style=${dbStatusStyle}>
          업로드 DB: 총 ${recordCount === '?' ? '?' : recordCount.toLocaleString('ko-KR')}개 레코드 / 합계 ${totalSum === '?' ? '?' : totalSum.toLocaleString('ko-KR')} 원
        </div>

        ${manualData.length > 0 && html`
          <div style=${tableContainerStyle}>
            <table style=${tableStyle}>
              <thead>
                <tr>
                  <th style=${thStyle}>정산월</th>
                  <th style=${thStyle}>작품명</th>
                  <th style=${{...thStyle, ...amountCellStyle}}>정산금액</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }
}
