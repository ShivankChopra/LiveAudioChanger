const { createHash } = require('crypto');
const { Transform } = require('stream');



function parsePacketHeaders(buffer) {
    let offset = 0; // in bytes

    const firstByte = buffer.readInt8(offset); // parse first byte
    const isFinalFrame = (firstByte >>> 7) & 0x1;
    const [rsrv1, rsrv2, rsrv3] = [(firstByte >>> 6) & 0x1, (firstByte >>> 5) & 0x1, (firstByte >>> 4) & 0x1];
    const opCode = firstByte & 0xf; // 1111
    offset += 1;

    const secondByte = buffer.readInt8(offset);
    const isMasked = (secondByte >>> 7) & 0x1;
    let payloadLength = secondByte & 0x7f; // 1111111
    offset += 1;

    if (payloadLength === 126) { // need to read from 2 bytes
        payloadLength = buffer.readInt16BE(offset);
        offset += 2;
    } else if (payloadLength === 127) { // need to read from next 8 bytes
        payloadLength = buffer.readInt64BE(offset);
        offset += 8;
    }

    return { isFinalFrame, rsrv1, rsrv2, rsrv3, opCode, isMasked, payloadLength, offset };
}



function getUnmaskedPayload(buffer) {
    const maskingKey = buffer.readUInt32BE(0);
    const maskingKeyArr = [
        (maskingKey >>> 8 * 3) & 0xf,
        (maskingKey >>> 8 * 2) & 0xf,
        (maskingKey >>> 8 * 1) & 0xf,
        maskingKey & 0xf
    ];
    let decoded = buffer.subarray(4, buffer.length - 1);
    for (let i = 0; i < decoded.byteLength; i++) {
        decoded[i] = decoded[i] ^ maskingKeyArr[i % 4];
    }
    return decoded;
}



function doWsHandshake(socket, headers) {
    const WS_MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
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



/* 
    Assemble valid websocket frames 
*/
let assembleStream = new Transform({});
assembleStream.remChunk = null; // track leftover buffer chunks
assembleStream._transform = function (buffer, encoding, cb) {
    // get total buffer to process
    let buffSize, aggrBuffer;
    if (!!this.remChunk) {
        aggrBuffer = Buffer.concat([this.remChunk, buffer]);
    } else {
        aggrBuffer = buffer;
    }
    buffSize = aggrBuffer.length;

    // get expected packet length
    const { payloadLength : pl, offset : headerLength } = parsePacketHeaders(aggrBuffer); 

    // manage remaining chunks and push complete packet
    if (buffSize - headerLength < pl) {
        this.remChunk = aggrBuffer;
    } else if (buffSize - headerLength == pl) {
        this.push(aggrBuffer);
        this.remChunk = null;
        cb();
    } else if (buffSize - headerLength > pl) {
        this.remChunk = aggrBuffer.slice(pl, buffSize);
        this.push(aggrBuffer.slice(0, pl - 1));
        cb();
    }
}



module.exports = { doWsHandshake, assembleStream, frameParseStream, makeWsPacketStream };