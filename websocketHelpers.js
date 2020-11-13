const { createHash } = require('crypto');
const { Transform } = require('stream');



function parsePacketHeaders(buffer) {
    let offset = 0; // in bytes

    const firstByte = buffer.readUInt8(offset); // parse first byte
    const isFinalFrame = (firstByte >>> 7) & 0x1;
    const [rsrv1, rsrv2, rsrv3] = [(firstByte >>> 6) & 0x1, (firstByte >>> 5) & 0x1, (firstByte >>> 4) & 0x1];
    const opCode = firstByte & 0xf; // 1111
    offset += 1;

    const secondByte = buffer.readUInt8(offset);
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



function writePacketHeaders(data, isContinueFrame) {
    let offset = 2;
    let payloadLength = data.length;

    if (data.length >= 65536) {
        offset += 8;
        payloadLength = 127;
    } else if (data.length > 125) {
        offset += 2;
        payloadLength = 126;
    }

    const headers = Buffer.allocUnsafe(offset);

    // final frame + binary frame opcode
    headers[0] = 0x80 + 0x2;
    headers[1] = payloadLength;

    if (payloadLength === 126) {
        headers.writeUInt16BE(data.length, 2);
    } else if (payloadLength === 127) {
        headers.writeUInt32BE(0, 2);
        headers.writeUInt32BE(data.length, 6);
    }
    return Buffer.concat([headers, data]);
}



function getUnmaskedPayload(buffer) {
    console.log(`Buffer length is : ${buffer.length}`);
    if (buffer.length < 5) return buffer;
    const maskingKey = buffer.readUInt32BE(0);
    const maskingKeyArr = [
        (maskingKey >>> 8 * 3) & 0xff,
        (maskingKey >>> 8 * 2) & 0xff,
        (maskingKey >>> 8 * 1) & 0xff,
        maskingKey & 0xff
    ];
    let decoded = buffer.subarray(4, buffer.length - 1);
    for (let i = 0; i < decoded.byteLength; i++) {
        decoded[i] = decoded[i] ^ maskingKeyArr[i % 4];
    }
    console.log('Unmasking payload');
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
    const { payloadLength: pl, offset: headerLength, isMasked } = parsePacketHeaders(aggrBuffer);
    const totalPayloadLength = pl + (isMasked == 1 ? 4 : 0);

    // manage remaining chunks and push complete packet
    if (buffSize - headerLength < totalPayloadLength) {
        this.remChunk = aggrBuffer;
    } else if (buffSize - headerLength == totalPayloadLength) {
        this.push(aggrBuffer);
        this.remChunk = null;
        cb();
    } else if (buffSize - headerLength > totalPayloadLength) {
        this.remChunk = aggrBuffer.slice(totalPayloadLength, buffSize);
        this.push(aggrBuffer.slice(0, totalPayloadLength));
        cb();
    }
}



/*
    Unmask and decode the payload data from websocket frame
*/
let frameParseStream = new Transform({});
frameParseStream._transform = function (buffer, encoding, cb) {
    const { payloadLength: pl, offset: headerLength, isMasked } = parsePacketHeaders(buffer);
    const totalPayloadLength = pl + (isMasked == 1 ? 4 : 0);
    let unmaskedBuffer;
    if (isMasked == 1) {
        unmaskedBuffer = getUnmaskedPayload(buffer.slice(headerLength, totalPayloadLength));
    } else {
        unmaskedBuffer = buffer.slice(headerLength, totalPayloadLength);
    }
    this.push(unmaskedBuffer);
    cb();
}



let makeWsPacketStream = new Transform({});
makeWsPacketStream.sendContinueFrame = false;
makeWsPacketStream._transform = function (buffer, encoding, cb) {
    const frameBuffer = writePacketHeaders(buffer, this.sendContinueFrame);
    // if (!this.sendContinueFrame) {
    //     this.sendContinueFrame = true;
    // }
    this.push(frameBuffer);
    cb();
}



module.exports = { doWsHandshake, assembleStream, frameParseStream, makeWsPacketStream };