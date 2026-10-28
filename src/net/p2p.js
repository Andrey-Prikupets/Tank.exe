// WebRTC Peer-to-Peer Connection Manager for Tank.exe
import { packSignal, unpackSignal } from './payload.js';

export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class P2PConnection {
  constructor(options = {}) {
    this.iceServers = options.iceServers || ICE_SERVERS;
    this.pc = null;
    this.dc = null;
    this.isHost = false;
    this.state = 'idle'; // 'idle' | 'offering' | 'answering' | 'connecting' | 'connected' | 'closed'

    this.onOpen = options.onOpen || (() => {});
    this.onClose = options.onClose || (() => {});
    this.onMessage = options.onMessage || (() => {});
    this.onError = options.onError || (() => {});
    this.onStateChange = options.onStateChange || (() => {});
  }

  setState(newState) {
    this.state = newState;
    this.onStateChange(newState);
  }

  /**
   * Waits for ICE candidate gathering to finish so the SDP includes all candidates.
   */
  waitForIceGathering(pc, timeoutMs = 2500) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      let timer = null;
      const check = () => {
        if (pc.iceGatheringState === 'complete') {
          cleanup();
          resolve();
        }
      };
      const onCandidate = (e) => {
        if (!e.candidate) {
          cleanup();
          resolve();
        }
      };
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', check);
        pc.removeEventListener('icecandidate', onCandidate);
      };
      pc.addEventListener('icegatheringstatechange', check);
      pc.addEventListener('icecandidate', onCandidate);
      timer = setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);
    });
  }

  setupDataChannel(dc) {
    this.dc = dc;
    dc.onopen = () => {
      this.setState('connected');
      this.onOpen();
    };
    dc.onclose = () => {
      this.setState('closed');
      this.onClose();
    };
    dc.onerror = (err) => {
      this.onError(err);
    };
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.onMessage(msg);
      } catch {
        this.onMessage(e.data);
      }
    };
  }

  /**
   * Host step 1: Generates an Offer token to be displayed as QR or copied.
   */
  async createHostOffer() {
    this.close();
    this.isHost = true;
    this.setState('offering');

    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const dc = this.pc.createDataChannel('tank-game', { ordered: true });
    this.setupDataChannel(dc);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    await this.waitForIceGathering(this.pc);
    return packSignal(this.pc.localDescription);
  }

  /**
   * Host step 2: Ingests Answer token from Client.
   */
  async applyAnswerToken(answerToken) {
    if (!this.pc) throw new Error('Host connection not initialized');
    const desc = unpackSignal(answerToken);
    if (!desc || desc.type !== 'answer') {
      throw new Error('Invalid Answer code');
    }
    this.setState('connecting');
    await this.pc.setRemoteDescription(new RTCSessionDescription(desc));
  }

  /**
   * Joiner step: Ingests Host Offer token, generates Answer token.
   */
  async createJoinerAnswer(offerToken) {
    this.close();
    this.isHost = false;
    this.setState('answering');

    const desc = unpackSignal(offerToken);
    if (!desc || desc.type !== 'offer') {
      throw new Error('Invalid Offer code');
    }

    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc.ondatachannel = (e) => {
      this.setupDataChannel(e.channel);
    };

    await this.pc.setRemoteDescription(new RTCSessionDescription(desc));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    await this.waitForIceGathering(this.pc);
    this.setState('connecting');
    return packSignal(this.pc.localDescription);
  }

  send(msg) {
    if (this.dc && this.dc.readyState === 'open') {
      const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
      this.dc.send(payload);
      return true;
    }
    return false;
  }

  close() {
    if (this.dc) {
      try { this.dc.close(); } catch {}
      this.dc = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch {}
      this.pc = null;
    }
    this.setState('closed');
  }
}
