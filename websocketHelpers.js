const { createHash } = require('crypto');
const { Transform } = require('stream');

const WS_MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

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