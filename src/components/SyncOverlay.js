import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

// 로딩 아이콘 SVG
const LoadingIcon = () => html`
  <svg width="16" height="16" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid" style=${{display: 'inline-block', verticalAlign: 'middle', marginLeft: '5px'}}>
    <circle cx="50" cy="50" fill="none" stroke="#fff" stroke-width="10" r="35" stroke-dasharray="164.93361431346415 56.97787143782138">
      <animateTransform attributeName="transform" type="rotate" repeatCount="indefinite" dur="1s" values="0 50 50;360 50 50" keyTimes="0;1"></animateTransform>
    </circle>
  </svg>
`;

export function SyncOverlay() {
  const [syncState, setSyncState] = useState('idle'); // idle, syncing, complete, error, cancelled
  const [statusText, setStatusText] = useState('');
  const [totalSum, setTotalSum] = useState(null);
  const [sumByTitle, setSumByTitle] = useState({});
  const [failedMonths, setFailedMonths] = useState([]);
  const [recordCount, setRecordCount] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  const currentYear = new Date().getFullYear();
  const [startYear, setStartYear] = useState(2011);
  const [startMonth, setStartMonth] = useState(1);

  const formatNumber = (num) => num != null ? num.toLocaleString('ko-KR') : '0';

  // 데이터 로드 함수
  const loadData = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'getTotalSum' }, response => {
      if (chrome.runtime.lastError) console.error("Error getTotalSum:", chrome.runtime.lastError.message);
      else if (response?.status === 'success') setTotalSum(response.totalSum);
      else if (response?.status === 'error') console.error("Error getTotalSum:", response.message);
    });
    chrome.runtime.sendMessage({ type: 'getSumByTitle' }, response => {
       if (chrome.runtime.lastError) console.error("Error getSumByTitle:", chrome.runtime.lastError.message);
       else if (response?.status === 'success') setSumByTitle(response.sums || {});
       else if (response?.status === 'error') console.error("Error getSumByTitle:", response.message);
     });
    chrome.runtime.sendMessage({ type: 'getRecordCount' }, response => {
      if (chrome.runtime.lastError) console.error("Error getRecordCount:", chrome.runtime.lastError.message);
      else if (response?.status === 'success') setRecordCount(response.count);
      else if (response?.status === 'error') console.error("Error getRecordCount:", response.message);
    });
  }, []);

  // 동기화 시작/취소 버튼 핸들러
  const handleSyncButtonClick = useCallback(() => {
    if (syncState === 'syncing') {
      setStatusText('취소 요청 중...');
      chrome.runtime.sendMessage({ type: 'cancelSync' }, response => {
        if (chrome.runtime.lastError) {
          setErrorMessage('취소 요청 실패: ' + chrome.runtime.lastError.message);
          setStatusText('');
        } else if (response?.status === 'cancelled') {
          // 상태 업데이트는 messageListener에서 처리
        } else if (response?.status === 'not_syncing') {
           setSyncState('idle');
           setStatusText('');
        }
      });
    } else {
      setSyncState('syncing');
      setStatusText('동기화 시작 중...'); // "시작 중..." 텍스트 설정
      setFailedMonths([]);
      setErrorMessage('');
      chrome.runtime.sendMessage({
        type: 'startFullSync',
        startDate: { year: startYear, month: startMonth }
      }, response => {
        if (chrome.runtime.lastError) {
          setSyncState('error');
          setErrorMessage('동기화 시작 오류: ' + chrome.runtime.lastError.message);
          setStatusText('');
        } else if (response?.status === 'error') {
          setSyncState('error');
          setErrorMessage('동기화 시작 오류: ' + response.message);
          setStatusText('');
        } else if (response?.status !== 'started') {
           setSyncState('error');
           setErrorMessage('동기화 시작 중 예상치 못한 응답');
           setStatusText('');
        }
        // 성공적으로 시작되면 progressUpdate 메시지가 상태를 업데이트함
      });
    }
  }, [syncState, startYear, startMonth]); // loadData 제거

  // 컴포넌트 마운트 및 메시지 리스너 설정
  useEffect(() => {
    loadData(); // 초기 데이터 로드
    const recordCountIntervalId = setInterval(loadData, 15000); // 주기적 업데이트

    const messageListener = (message) => {
      switch (message.type) {
        case 'progressUpdate':
          setSyncState('syncing');
          setStatusText(message.month ? `${message.month} 동기화 중...` : '동기화 준비 중...');
          if (message.error) {
             setStatusText(`${message.month} 처리 중 오류 (${message.error})`);
          } else {
            setErrorMessage('');
          }
          break;
        case 'syncComplete':
          setSyncState('complete');
          setStatusText('동기화 완료');
          setFailedMonths(message.failedMonths || []);
          loadData();
          // 완료 후 잠시 뒤 idle 상태로 돌아가기
          setTimeout(() => {
             // 현재 상태가 complete일 때만 idle로 변경
             if (syncState === 'complete') {
                 setSyncState('idle');
                 setStatusText('');
             }
          }, 3000);
          break;
        case 'syncCancelled':
          setSyncState('cancelled');
          setStatusText('동기화 취소됨');
          loadData();
          // 취소 후 잠시 뒤 idle 상태로 돌아가기
          setTimeout(() => {
             // 현재 상태가 cancelled일 때만 idle로 변경
             if (syncState === 'cancelled') {
                 setSyncState('idle');
                 setStatusText('');
             }
          }, 3000);
          break;
        case 'syncError':
          setSyncState('error');
          setStatusText('동기화 중 오류 발생');
          setErrorMessage(message.message || '알 수 없는 오류');
          // 에러 발생 시 잠시 뒤 idle 상태로 돌아가기 (선택 사항)
          // setTimeout(() => {
          //    if (syncState === 'error') {
          //       setSyncState('idle');
          //       setStatusText('');
          //    }
          // }, 5000);
          break;
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      clearInterval(recordCountIntervalId);
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadData, syncState]); // syncState를 의존성 배열에 추가하여 상태 변경 시 로직 재평가

  // 스타일 정의
  const overlayStyle = {
    position: 'fixed', bottom: '20px', left: '20px', padding: '15px',
    backgroundColor: 'rgba(20, 20, 20, 0.9)', color: '#e0e0e0',
    fontFamily: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', fontSize: '13px',
    zIndex: '9999', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    minWidth: '320px', maxWidth: '450px', lineHeight: '1.6'
  };
  const inputGroupStyle = { display: 'flex', alignItems: 'center', marginBottom: '8px' };
  const labelStyle = { marginRight: '8px', color: '#bdbdbd' };
  const selectStyle = {
    padding: '4px 8px', fontSize: '13px', backgroundColor: '#424242',
    color: '#e0e0e0', border: '1px solid #616161', borderRadius: '4px', marginRight: '8px'
  };
  const buttonStyle = {
    padding: '8px 16px', fontSize: '14px', fontWeight: '500', cursor: 'pointer',
    backgroundColor: syncState === 'syncing' ? '#f44336' : '#009688', color: 'white',
    border: 'none', borderRadius: '4px', display: 'flex', alignItems: 'center',
    justifyContent: 'center', transition: 'background-color 0.2s ease', flexGrow: 1
  };
  const statusTextStyle = {
     marginTop: '8px', fontSize: '12px', color: '#bdbdbd', minHeight: '1.2em'
   };
  const errorStyle = { color: '#ef9a9a', marginTop: '10px', fontSize: '12px' };
  const warningStyle = { color: '#fff59d', marginTop: '8px', fontSize: '12px' };
  const infoStyle = { fontSize: '12px', color: '#9e9e9e', marginLeft: '5px' };
  const hrStyle = { borderColor: '#424242', margin: '12px 0', borderStyle: 'solid', borderWidth: '1px 0 0 0' };
  const tableContainerStyle = { marginTop: '10px', maxHeight: '200px', overflowY: 'auto' };
  const tableStyle = { width: '100%', borderCollapse: 'collapse' };
  const thTdStyle = { padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #424242' };
  const thStyle = {
    ...thTdStyle, color: '#bdbdbd', fontWeight: '500', position: 'sticky',
    top: 0, backgroundColor: 'rgba(20, 20, 20, 0.9)'
  };
  const amountCellStyle = { textAlign: 'right' };

  // 년도/월 옵션 생성
  const yearOptions = Array.from({ length: currentYear - 2011 + 1 }, (_, i) => 2011 + i)
    .map(y => html`<option value=${y}>${y}</option>`);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1)
    .map(m => html`<option value=${m}>${m}</option>`);

  // 작품별 합계 행 생성
  const sumByTitleRows = Object.entries(sumByTitle)
    .sort(([, sumA], [, sumB]) => sumB - sumA)
    .map(([title, sum]) => html`
      <tr key=${title}>
        <td style=${thTdStyle}>${title}</td>
        <td style=${{...thTdStyle, ...amountCellStyle}}>${formatNumber(sum)} 원</td>
      </tr>
    `);

  // 버튼 내용 결정
  let buttonContent;
  if (syncState === 'syncing') {
    buttonContent = html`동기화 취소 <${LoadingIcon} />`;
  } else {
    buttonContent = '데이터 동기화';
  }

  // 상태 텍스트 렌더링 결정
  let statusDisplay = null;
  // idle 상태가 아닐 때만 statusText 표시
  if (syncState !== 'idle' && statusText) {
    statusDisplay = html`<div style=${statusTextStyle}>${statusText}</div>`;
  }

  // 에러 메시지 렌더링 결정
  let errorDisplay = null;
  if (errorMessage) {
    errorDisplay = html`<div style=${errorStyle}>${errorMessage}</div>`;
  }

  // 총 합계 렌더링 결정
  let totalSumDisplay = null;
  if (totalSum !== null) {
    totalSumDisplay = html`
      <hr style=${hrStyle}/>
      <div style=${{marginBottom: '8px'}}>
        <strong>총 정산액: ${formatNumber(totalSum)} 원</strong>
        ${recordCount !== null ? html`<span style=${infoStyle}>(${recordCount}개 레코드)</span>` : null}
      </div>
    `;
  }

  // 작품별 합계 렌더링 결정
  let sumByTitleDisplay = null;
  if (sumByTitleRows.length > 0) {
    sumByTitleDisplay = html`
      <div style=${{marginTop: '10px'}}>
         <h4 style=${{margin: '0 0 5px 0', color: '#bdbdbd', fontSize: '13px', fontWeight: '500'}}>작품별 합계</h4>
         <div style=${tableContainerStyle}>
           <table style=${tableStyle}>
             <thead>
               <tr>
                 <th style=${thStyle}>작품명</th>
                 <th style=${{...thStyle, ...amountCellStyle}}>합계</th>
               </tr>
             </thead>
             <tbody>${sumByTitleRows}</tbody>
           </table>
         </div>
      </div>
    `;
  }

  // 실패 월 렌더링 결정
  let failedMonthsDisplay = null;
  if (failedMonths.length > 0) {
    failedMonthsDisplay = html`
      <div style=${warningStyle}>
        경고: 다음 월 데이터 가져오기 실패: ${failedMonths.join(', ')}
      </div>
    `;
  }

  return html`
    <div style=${overlayStyle}>
      <div style=${inputGroupStyle}>
        <select value=${startYear} style=${selectStyle} onChange=${(e) => setStartYear(parseInt(e.target.value))} disabled=${syncState === 'syncing'}>${yearOptions}</select>
        <span style=${labelStyle}>년</span>
        <select value=${startMonth} style=${selectStyle} onChange=${(e) => setStartMonth(parseInt(e.target.value))} disabled=${syncState === 'syncing'}>${monthOptions}</select>
        <span style=${labelStyle}>월 부터</span>
        <button onClick=${handleSyncButtonClick} style=${buttonStyle}>
          ${buttonContent}
        </button>
      </div>

      ${statusDisplay}
      ${errorDisplay}
      ${totalSumDisplay}
      ${sumByTitleDisplay}
      ${failedMonthsDisplay}
    </div>
  `;
}
