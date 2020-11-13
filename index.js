const { createServer } = require('http');
const fs = require('fs');
const { doWsHandshake, assembleStream, frameParseStream, makeWsPacketStream } = require('./websocketHelpers');



const server = createServer((req, res) => {
    try {
        if (req.url == '/voiceChanger') {
            fs.createReadStream('./static/index.html').pipe(res);
        } else if (req.url == '/listen') {
            fs.createReadStream('./static/listen.html').pipe(res);
        } else {
            res.write('404 Not found mate :)');
            res.end();
        }
    } catch (e) {
        console.log(e);
        res.write('Oops something broke! :(');
        res.end();
    }
});



let feedSocket = null, listenSocket = null;



// web socket 
server.on('upgrade', (req, socket, head) => {
    try {
        const { headers, url } = req;
        if (url == '/feedAudio') {
            doWsHandshake(socket, headers);
            feedSocket = socket;
            // feedSocket
            //     .pipe(assembleStream)
            //     .pipe(frameParseStream)
            //     // .pipe(fs.createWriteStream('./clientDump.webm'))
            //     .pipe(makeWsPacketStream);
            //if (!!listenSocket) feedSocket.pipe(listenSocket);
        } else if (url == '/listenAudio') {
            doWsHandshake(socket, headers);
            listenSocket = socket;
            if (!!feedSocket) {
                feedSocket
                    .pipe(assembleStream)
                    .pipe(frameParseStream)
                    .pipe(makeWsPacketStream)
                    .pipe(listenSocket);
            }
        }
    } catch (err) {
        console.log(err);
    }
});



server.listen(3000, '0.0.0.0', () => console.log('Server listening on port 3000'));



process.on('unhandledRejection', err => console.log(err));
process.on('uncaughtException', err => console.log(err));
