// Network Multiplayer Modal (P2P via QR / Messengers)
import * as C from '../constants.js';
import { P2PConnection } from '../net/p2p.js';
import { renderQrToCanvas, createQrScanner } from '../net/qr.js';

export function createNetworkModal(root) {
  let callbacks = { onStartGame: () => {}, onClose: () => {} };
  let p2p = null;
  let activeTab = 'host'; // 'host' | 'connect'
  let hostPlayer = 0; // 0: Red (left squadron, P1), 1: Blue (right squadron, P2)
  let currentOfferToken = '';
  let currentAnswerToken = '';
  let scanner = null;
  let statusMessage = '';
  let isConnecting = false;

  function setStatus(msg) {
    statusMessage = msg;
    const el = root.querySelector('.net-status-bar');
    if (el) el.textContent = msg;
  }

  function stopScanner() {
    if (scanner) {
      scanner.stop();
      scanner = null;
    }
    const scannerOverlay = root.querySelector('.net-scanner-overlay');
    if (scannerOverlay) scannerOverlay.classList.add('hidden');
  }

  function startScanning(onDetected) {
    stopScanner();
    const scannerOverlay = root.querySelector('.net-scanner-overlay');
    const video = root.querySelector('.net-scanner-video');
    if (!scannerOverlay || !video) return;

    scannerOverlay.classList.remove('hidden');
    setStatus('Point camera at QR code...');

    scanner = createQrScanner(
      video,
      (text) => {
        stopScanner();
        onDetected(text);
      },
      (err) => {
        stopScanner();
        setStatus(err);
      }
    );
  }

  async function shareText(title, text) {
    if (navigator.share) {
      try {
        await navigator.share({ title, text });
        setStatus('Offer shared successfully!');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    copyText(text);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Code copied to clipboard!');
    } catch {
      setStatus('Unable to copy automatically. Please select and copy text below.');
    }
  }

  async function initHost() {
    isConnecting = false;
    currentOfferToken = '';
    currentAnswerToken = '';
    setStatus('Generating connection offer...');
    render();

    p2p = new P2PConnection({
      onOpen: () => {
        isConnecting = true;
        setStatus('Connected! Starting network match...');
        setTimeout(() => {
          closeModal();
          callbacks.onStartGame({
            isHost: true,
            p2p,
            localPlayer: hostPlayer,
            remotePlayer: hostPlayer === 0 ? 1 : 0,
          });
        }, 500);
      },
      onClose: () => {
        setStatus('Peer disconnected.');
      },
      onError: (err) => {
        setStatus('Network error: ' + (err.message || err));
      },
    });

    try {
      currentOfferToken = await p2p.createHostOffer();
      setStatus('Offer ready! Have Player 2 scan the QR code or share it.');
      render();
    } catch (err) {
      setStatus('Failed to generate offer: ' + err.message);
      render();
    }
  }

  function initConnect() {
    isConnecting = false;
    currentOfferToken = '';
    currentAnswerToken = '';
    setStatus('Ready to connect. Scan Host QR code or paste their offer.');

    p2p = new P2PConnection({
      onOpen: () => {
        isConnecting = true;
        setStatus('Connected! Syncing with host...');
        // Wait for INIT packet from host
        callbacks.onStartGame({
          isHost: false,
          p2p,
          localPlayer: 1, // Will be updated by INIT packet
          remotePlayer: 0,
        });
        closeModal();
      },
      onClose: () => {
        setStatus('Peer disconnected.');
      },
      onError: (err) => {
        setStatus('Network error: ' + (err.message || err));
      },
    });
    render();
  }

  async function applyOfferText(text) {
    if (!text || !p2p) return;
    setStatus('Processing host offer...');
    try {
      currentAnswerToken = await p2p.createJoinerAnswer(text);
      setStatus('Answer generated! Show this QR code to the Host or copy & share it.');
      render();
    } catch (err) {
      setStatus('Invalid offer: ' + err.message);
      render();
    }
  }

  async function applyAnswerText(text) {
    if (!text || !p2p) return;
    setStatus('Ingesting client answer...');
    try {
      await p2p.applyAnswerToken(text);
      setStatus('Establishing direct P2P data connection...');
    } catch (err) {
      setStatus('Invalid answer: ' + err.message);
    }
  }

  function render() {
    root.innerHTML = '';

    const modal = document.createElement('div');
    modal.className = 'net-modal';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'net-header';
    hdr.innerHTML = `
      <h2 class="net-title">MULTIPLAYER (NETWORK P2P)</h2>
      <p class="net-subtitle">Direct browser-to-browser connection · Zero server required</p>
    `;
    modal.appendChild(hdr);

    // Tab Switch
    const tabSwitch = document.createElement('div');
    tabSwitch.className = 'net-tab-switch';

    const hostTabBtn = document.createElement('button');
    hostTabBtn.className = `net-tab-btn ${activeTab === 'host' ? 'active' : ''}`;
    hostTabBtn.textContent = 'HOST A GAME';
    hostTabBtn.addEventListener('click', () => {
      if (activeTab === 'host') return;
      activeTab = 'host';
      stopScanner();
      initHost();
    });
    tabSwitch.appendChild(hostTabBtn);

    const connectTabBtn = document.createElement('button');
    connectTabBtn.className = `net-tab-btn ${activeTab === 'connect' ? 'active' : ''}`;
    connectTabBtn.textContent = 'CONNECT TO HOST';
    connectTabBtn.addEventListener('click', () => {
      if (activeTab === 'connect') return;
      activeTab = 'connect';
      stopScanner();
      initConnect();
    });
    tabSwitch.appendChild(connectTabBtn);
    modal.appendChild(tabSwitch);

    // Status bar
    const statusBar = document.createElement('div');
    statusBar.className = 'net-status-bar';
    statusBar.textContent = statusMessage || 'Choose an option above.';
    modal.appendChild(statusBar);

    // Content body
    const body = document.createElement('div');
    body.className = 'net-body';

    if (activeTab === 'host') {
      // Team selector
      const teamRow = document.createElement('div');
      teamRow.className = 'net-team-row';
      teamRow.innerHTML = `<span class="net-label">Host Team:</span>`;

      const redBtn = document.createElement('button');
      redBtn.className = `net-team-btn red ${hostPlayer === 0 ? 'selected' : ''}`;
      redBtn.textContent = 'RED TEAM (P1 · LEFT)';
      redBtn.addEventListener('click', () => {
        hostPlayer = 0;
        render();
      });
      teamRow.appendChild(redBtn);

      const blueBtn = document.createElement('button');
      blueBtn.className = `net-team-btn blue ${hostPlayer === 1 ? 'selected' : ''}`;
      blueBtn.textContent = 'BLUE TEAM (P2 · RIGHT)';
      blueBtn.addEventListener('click', () => {
        hostPlayer = 1;
        render();
      });
      teamRow.appendChild(blueBtn);
      body.appendChild(teamRow);

      if (currentOfferToken) {
        // Step 1: Offer QR & Share
        const step1 = document.createElement('div');
        step1.className = 'net-step-block';
        step1.innerHTML = `<div class="net-step-title">STEP 1: Share Offer with Player 2</div>`;

        const qrWrap = document.createElement('div');
        qrWrap.className = 'net-qr-wrap';
        const canvas = document.createElement('canvas');
        canvas.className = 'net-qr-canvas';
        renderQrToCanvas(canvas, currentOfferToken, { scale: 3 });
        qrWrap.appendChild(canvas);
        step1.appendChild(qrWrap);

        const actionsRow = document.createElement('div');
        actionsRow.className = 'net-btn-row';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'net-action-btn';
        copyBtn.textContent = 'COPY OFFER TEXT';
        copyBtn.addEventListener('click', () => copyText(currentOfferToken));
        actionsRow.appendChild(copyBtn);

        const shareBtn = document.createElement('button');
        shareBtn.className = 'net-action-btn';
        shareBtn.textContent = 'SHARE VIA...';
        shareBtn.addEventListener('click', () => shareText('Tank.exe Game Offer', currentOfferToken));
        actionsRow.appendChild(shareBtn);

        step1.appendChild(actionsRow);
        body.appendChild(step1);

        // Step 2: Ingest Answer
        const step2 = document.createElement('div');
        step2.className = 'net-step-block';
        step2.innerHTML = `<div class="net-step-title">STEP 2: Connect Player 2's Answer</div>`;

        const step2Btns = document.createElement('div');
        step2Btns.className = 'net-btn-row';

        const scanAnswerBtn = document.createElement('button');
        scanAnswerBtn.className = 'net-action-btn highlight';
        scanAnswerBtn.textContent = 'SCAN CLIENT QR';
        scanAnswerBtn.addEventListener('click', () => {
          startScanning((scanned) => applyAnswerText(scanned));
        });
        step2Btns.appendChild(scanAnswerBtn);

        const pasteAnswerBtn = document.createElement('button');
        pasteAnswerBtn.className = 'net-action-btn';
        pasteAnswerBtn.textContent = 'PASTE ANSWER CODE';
        pasteAnswerBtn.addEventListener('click', async () => {
          try {
            const clip = await navigator.clipboard.readText();
            if (clip) {
              applyAnswerText(clip);
              return;
            }
          } catch {}
          const userVal = prompt('Paste client answer code here:');
          if (userVal) applyAnswerText(userVal);
        });
        step2Btns.appendChild(pasteAnswerBtn);

        step2.appendChild(step2Btns);
        body.appendChild(step2);
      }
    } else {
      // Connect tab
      if (!currentAnswerToken) {
        const step1 = document.createElement('div');
        step1.className = 'net-step-block';
        step1.innerHTML = `<div class="net-step-title">STEP 1: Ingest Host's Game Offer</div>`;

        const step1Btns = document.createElement('div');
        step1Btns.className = 'net-btn-row';

        const scanOfferBtn = document.createElement('button');
        scanOfferBtn.className = 'net-action-btn highlight';
        scanOfferBtn.textContent = 'SCAN HOST QR CODE';
        scanOfferBtn.addEventListener('click', () => {
          startScanning((scanned) => applyOfferText(scanned));
        });
        step1Btns.appendChild(scanOfferBtn);

        const pasteOfferBtn = document.createElement('button');
        pasteOfferBtn.className = 'net-action-btn';
        pasteOfferBtn.textContent = 'PASTE HOST OFFER';
        pasteOfferBtn.addEventListener('click', async () => {
          try {
            const clip = await navigator.clipboard.readText();
            if (clip) {
              applyOfferText(clip);
              return;
            }
          } catch {}
          const userVal = prompt('Paste host offer code here:');
          if (userVal) applyOfferText(userVal);
        });
        step1Btns.appendChild(pasteOfferBtn);

        step1.appendChild(step1Btns);
        body.appendChild(step1);
      } else {
        // Step 2: Show Answer QR for Host to scan
        const step2 = document.createElement('div');
        step2.className = 'net-step-block';
        step2.innerHTML = `<div class="net-step-title">STEP 2: Have Host Scan This Answer</div>`;

        const qrWrap = document.createElement('div');
        qrWrap.className = 'net-qr-wrap';
        const canvas = document.createElement('canvas');
        canvas.className = 'net-qr-canvas';
        renderQrToCanvas(canvas, currentAnswerToken, { scale: 3 });
        qrWrap.appendChild(canvas);
        step2.appendChild(qrWrap);

        const actionsRow = document.createElement('div');
        actionsRow.className = 'net-btn-row';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'net-action-btn';
        copyBtn.textContent = 'COPY ANSWER';
        copyBtn.addEventListener('click', () => copyText(currentAnswerToken));
        actionsRow.appendChild(copyBtn);

        const shareBtn = document.createElement('button');
        shareBtn.className = 'net-action-btn';
        shareBtn.textContent = 'SHARE VIA...';
        shareBtn.addEventListener('click', () => shareText('Tank.exe Game Answer', currentAnswerToken));
        actionsRow.appendChild(shareBtn);

        step2.appendChild(actionsRow);
        body.appendChild(step2);
      }
    }

    modal.appendChild(body);

    // Footer actions
    const footer = document.createElement('div');
    footer.className = 'net-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'net-cancel-btn';
    cancelBtn.textContent = 'BACK TO MENU';
    cancelBtn.addEventListener('click', closeModal);
    footer.appendChild(cancelBtn);
    modal.appendChild(footer);

    // Camera scanner overlay (hidden until requested)
    const scannerOverlay = document.createElement('div');
    scannerOverlay.className = 'net-scanner-overlay hidden';
    scannerOverlay.innerHTML = `
      <div class="net-scanner-card">
        <div class="net-scanner-title">ALIGN QR CODE IN FRAME</div>
        <div class="net-video-wrap">
          <video class="net-scanner-video" autoplay playsinline muted></video>
          <div class="net-crosshair"></div>
        </div>
        <button class="net-cancel-btn close-cam-btn">CLOSE CAMERA</button>
      </div>
    `;
    scannerOverlay.querySelector('.close-cam-btn').addEventListener('click', stopScanner);
    modal.appendChild(scannerOverlay);

    root.appendChild(modal);
  }

  function closeModal() {
    stopScanner();
    if (p2p && !isConnecting) {
      p2p.close();
      p2p = null;
    }
    root.classList.add('hidden');
    callbacks.onClose();
  }

  return {
    isOpen: () => !root.classList.contains('hidden'),
    open(cb) {
      callbacks = { ...callbacks, ...cb };
      root.classList.remove('hidden');
      activeTab = 'host';
      initHost();
    },
    close: closeModal,
  };
}
