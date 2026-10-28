import assert from 'assert';
import { compressToBase64, decompressFromBase64, packSignal, unpackSignal } from '../src/net/payload.js';

console.log('Testing native CompressionStream net payload...');

const sampleSdp = `v=0
o=- 123456789 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:abcd
a=ice-pwd:secretpassword123456789
a=fingerprint:sha-256 12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF
a=setup:actpass
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
a=candidate:1 1 UDP 2122260223 192.168.1.55 52834 typ host
a=candidate:2 1 UDP 1686052607 203.0.113.15 61240 typ srflx raddr 192.168.1.55 rport 52834
`;

const largeSdp = sampleSdp.repeat(3);
const compressedLarge = await compressToBase64(largeSdp);
const decompressedLarge = await decompressFromBase64(compressedLarge);
assert.strictEqual(decompressedLarge, largeSdp);
assert(compressedLarge.length < largeSdp.length, 'Large payload must compress significantly');

// Test 2: packSignal and unpackSignal roundtrip on regular sampleSdp
const offer = {
  type: 'offer',
  sdp: sampleSdp,
};

const token = await packSignal(offer);
assert(token.startsWith('TANK:'), 'Token should have TANK: prefix');
const unpacked = await unpackSignal(token);
assert.strictEqual(unpacked.type, 'offer');
assert.strictEqual(unpacked.sdp, sampleSdp);

// Test 3: Answer token roundtrip
const answer = {
  type: 'answer',
  sdp: sampleSdp.replace('a=setup:actpass', 'a=setup:active'),
};
const answerToken = await packSignal(answer);
const unpackedAnswer = await unpackSignal(answerToken);
assert.strictEqual(unpackedAnswer.type, 'answer');
assert(unpackedAnswer.sdp.includes('a=setup:active'));

console.log(`✓ Native CompressionStream tests passed! Full SDP: ${largeSdp.length} chars -> Compressed: ${compressedLarge.length} chars (${Math.round((1 - compressedLarge.length/largeSdp.length)*100)}% reduction)`);
