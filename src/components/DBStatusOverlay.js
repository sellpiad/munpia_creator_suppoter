import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

export function DBStatusOverlay() {
  const [dbStatus, setDbStatus] = useState("연결 중...");
  const [recordCount, setRecordCount] = useState(null);

  useEffect(() => {
    async function updateDbStatus() {
      chrome.runtime.sendMessage({ type: 'getRecordCount' }, response => {
        if (chrome.runtime.lastError || response.status === 'error') {
          console.error("DB 상태 업데이트 오류:", chrome.runtime.lastError || response.message);
          setDbStatus("오류: " + (chrome.runtime.lastError ? chrome.runtime.lastError.message : response.message));
          setRecordCount(null);
        } else {
          setDbStatus("연결됨");
          setRecordCount(response.count);
        }
      });
    }

    updateDbStatus();
    const intervalId = setInterval(updateDbStatus, 5000); // Update every 5 seconds

    return () => clearInterval(intervalId); // Cleanup interval on component unmount
  }, []);

  const overlayStyle = {
    position: 'fixed',
    top: '20px',
    right: '500px', // Adjust position as needed
    padding: '15px',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    color: '#fff',
    fontFamily: '"Malgun Gothic", "맑은 고딕", sans-serif',
    fontSize: '14px',
    zIndex: '9999',
    borderRadius: '5px',
    boxShadow: '0 1px 5px rgba(0,0,0,0.4)',
    maxWidth: '300px',
    lineHeight: '1.6'
  };

  return html`
    <div style=${overlayStyle}>
      <strong>DB 상태:</strong> ${dbStatus}<br/>
      ${recordCount !== null ? `저장된 레코드: ${recordCount}개` : ""}
    </div>
  `;
}
