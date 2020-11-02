const { createHash } = require('crypto');
const { Transform } = require('stream');

const WS_MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function parsePacketHeaders(buffer) {
    let offset = 0; // in bytes

    const firstByte = buffer.readInt8(offset); // parse first byte
    const isFinalFrame = (firstByte >>> 7) & 0x1;
    const [rsrv1, rsrv2, rsrv3] = [(firstByte >>> 6) & 0x1, (firstByte >>> 5) & 0x1, (firstByte >>> 4) & 0x1];
    const opCode = firstByte & 0xf; // 1111
    offset += 1;

    const secondByte = buffer.readInt8(offset);
    const isMasked = (secondByte >>> 7) & 0x1;
    const payloadLength = secondByte & 0x7f; // 1111111
    offset += 1;

    if (payloadLength === 126) { // need to read from 2 bytes
        payloadLength = buffer.readInt16BE(offset);
        offset += 2;
    } else if (payloadLength === 127) { // need to read from next 8 bytes
        payloadLength = buffer.readInt64BE(offset);
        offset += 8;
    }

    let packetPayload;
    if (isMasked == 1) { // unmask the payload
        const maskingKey = buffer.readUInt32BE(offset);
        const maskingKeyArr = [
            (maskingKey >>> 3) & 0x1,
            (maskingKey >>> 2) & 0x1,
            (maskingKey >>> 1) & 0x1,
            maskingKey & 0x1
        ];
        packetPayload = buffer.subarray(offset + 4, buffer.length);
        for (let i = 0; i < packetPayload.length; i++) {
            packetPayload[i] = packetPayload[i] ^ maskingKeyArr[i % 4];
        }
    } else {
        packetPayload = buffer.subarray(offset, buffer.length);
    }

    return { isFinalFrame, rsrv1, rsrv2, rsrv3, opCode, payloadLength, payload: packetPayload };
}

const doWsHandshake = (socket, headers) => {
    let sha1 = createHash('sha1');
    sha1.update(`${headers['sec-websocket-key']}${WS_MAGIC_STRING}`);
    const secWebsocketAccept = sha1.digest().toString('base64');
    socket.write('HTTP/1.1 101 Web Socket Protocol Handshake\r\n' +
        'Upgrade: WebSocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${secWebsocketAccept}\r\n` +
        '\r\n');
}

let frameParseStream, makeWsPacketStream;

// Assemble valid websocket frames
let assembleStream = new Transform({});
assembleStream.remChunk = null; // track leftover buffer chunks
assembleStream._transform = function (buffer, encoding, cb) {
    let pl, buffSize, aggrBuffer;
    if (!!this.remChunk) {
        aggrBuffer = Buffer.concat([this.remChunk, buffer]);
    } else {
        aggrBuffer = buffer;
    }
    buffSize = aggrBuffer.length;

    // TODO: read payload length


    if (buffSize < pl) {
        this.remChunk = aggrBuffer;
    } else if (buffSize == pl) {
        this.push(aggrBuffer);
        this.remChunk = null;
        cb();
    } else if (buffSize > pl) {
        this.remChunk = aggrBuffer.slice(pl, buffSize);
        this.push(aggrBuffer.slice(0, pl - 1));
        cb();
    }
}

module.exports = { doWsHandshake, assembleStream, frameParseStream, makeWsPacketStream };