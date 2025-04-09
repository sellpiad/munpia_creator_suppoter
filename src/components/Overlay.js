import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

// 메인 페이지(마스터 탭)용 오버레이 컴포넌트
export function Overlay({ monthlyResults, monthList, externalMonthlySums, externalDataLoading }) {
  let totalMunpia = 0;
  let totalExternal = 0;
  const formatNumber = (num) => num != null ? num.toLocaleString('ko-KR') : '0';

  const monthItems = monthList.map(month => {
    const munpiaValue = monthlyResults[month];
    const externalValue = !externalDataLoading && externalMonthlySums[month] ? externalMonthlySums[month] : 0;
    const totalValue = (munpiaValue != null ? munpiaValue : 0) + externalValue;

    let displayMunpia;
    if (munpiaValue === null) {
      displayMunpia = "로딩중...";
    } else if (munpiaValue === undefined) {
      displayMunpia = "데이터 없음";
    } else {
      displayMunpia = formatNumber(munpiaValue) + " 원";
      totalMunpia += munpiaValue;
    }

    const displayExternal = externalDataLoading ? "로딩중..." : formatNumber(externalValue) + " 원";
    if (!externalDataLoading) totalExternal += externalValue;

    const displayTotal = externalDataLoading ? "로딩중..." : formatNumber(totalValue) + " 원";

    const year = month.substring(0, 4);
    const monthNum = month.substring(5, 7);
    const displayMonth = `${year}년 ${monthNum}월`;

    return html`
      <tr key=${month}>
        <td>${displayMonth}</td>
        <td>${displayMunpia}</td>
        <td>${displayExternal}</td>
        <td>${displayTotal}</td>
      </tr>
    `;
  });

  const grandTotal = totalMunpia + totalExternal;

  const overlayStyle = {
    position: 'fixed', top: '20px', right: '20px', padding: '15px',
    backgroundColor: 'rgba(0, 0, 0, 0.85)', color: '#fff',
    fontFamily: '"Malgun Gothic", "맑은 고딕", sans-serif', fontSize: '14px',
    zIndex: '9999', borderRadius: '5px', boxShadow: '0 1px 5px rgba(0,0,0,0.4)',
    maxWidth: '450px', lineHeight: '1.6'
  };
  const tableStyle = { // Add missing tableStyle definition
    width: '100%',
    marginTop: '10px',
    borderCollapse: 'collapse'
  };
  const thTdStyle = {
    border: '1px solid #555',
    padding: '4px 15px', // Adjusted padding: 4px top/bottom, 15px left/right
    textAlign: 'right',
    verticalAlign: 'middle'
  };
  const thStyle = {
    ...thTdStyle,
    backgroundColor: '#333',
    fontWeight: 'bold'
  };
  const firstColStyle = { textAlign: 'center' };

  return html`
    <div style=${overlayStyle}>
      <strong>월별 데이터:</strong><br/>
      <table style=${tableStyle}>
        <thead>
          <tr>
            <th style=${{...thStyle, ...firstColStyle}}>정산시기</th>
            <th style=${thStyle}>문피아</th>
            <th style=${thStyle}>외부 플랫폼</th>
            <th style=${thStyle}>합계</th>
          </tr>
        </thead>
        <tbody>
          ${monthItems}
        </tbody>
      </table>
      <hr style=${{ borderColor: '#555', margin: '10px 0' }}/>
      <strong>총 합계: ${formatNumber(grandTotal)} 원</strong>
      <div style=${{fontSize: '12px', color: '#aaa', marginTop: '5px'}}>
        (문피아: ${formatNumber(totalMunpia)} 원 + 외부: ${formatNumber(totalExternal)} 원)
      </div>
    </div>
  `;
}
